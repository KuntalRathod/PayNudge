/**
 * Daily overdue-detection cron job (Requirement 7.1).
 *
 * `runOverdueDetection(deps)` performs one full Overdue_Detector pass over every
 * invoice: it evaluates each invoice's status against the current calendar date,
 * transitions `sent` -> `overdue` when the current date is strictly later than
 * the due date, recomputes Days_Overdue for overdue invoices, and enqueues every
 * overdue invoice for follow-up drafting. `startOverdueDetectionSchedule(deps)`
 * wires the job to run at least once per calendar day.
 *
 * ## Pure logic is reused, not re-implemented
 *
 * The status-transition rule and the calendar-day arithmetic live in the pure,
 * property-tested `../lib/overdue.js` module ({@link evaluateOverdueTransition},
 * {@link computeDaysOverdue}). This job only orchestrates I/O around them, so the
 * transition/arithmetic behaviour (Req 7.2-7.7) stays validated in one place.
 *
 * ## Idempotency (re-running yields no additional changes)
 *
 * A persisted change happens only for a real `sent` -> `overdue` transition, and
 * the store's write is conditional on the row still being `sent`
 * ({@link SupabaseOverdueDetectionStore.markOverdue}). On a second run in the same
 * calendar window every already-`overdue` invoice is left unchanged by
 * {@link evaluateOverdueTransition} (it only acts on `sent`), so no further write
 * occurs. Days_Overdue is a *derived* value (there is no `days_overdue` column in
 * the schema): it is recomputed each pass from the due date and handed to the
 * drafter, which re-derives it identically — so recomputation is naturally stable
 * and side-effect-free (Req 7.7).
 *
 * ## Enqueuing eligible overdue invoices
 *
 * Every invoice that is `overdue` after evaluation is enqueued for drafting. The
 * job intentionally does NOT decide escalation eligibility itself: the draft
 * worker ({@link DraftDeps}/`draftFollowUp`) already guards on a strict tier
 * increase, the at-most-one-pending invariant, and the consecutive-failure cap,
 * and is idempotent. Enqueuing every overdue invoice each pass is therefore safe
 * and keeps the drafting policy in one place.
 *
 * ## Injectable, testable boundaries
 *
 * The database, the clock, and the drafter are all injected so the job is
 * unit-testable with fakes and never touches live Postgres or Gemini. The
 * production wiring is provided by {@link SupabaseOverdueDetectionStore} and
 * {@link createSupabaseOverdueDetectionDeps}.
 */

import { type SupabaseClient } from '@supabase/supabase-js';

import {
  createBackgroundSupabaseClient,
  draftFollowUp,
  SupabaseDraftStore,
  type BackgroundClientConfig,
} from '../ai/draftWorker.js';
import { createGeminiModel } from '../ai/geminiDraft.js';
import {
  computeDaysOverdue,
  evaluateOverdueTransition,
  type Status,
} from '../lib/overdue.js';

/**
 * The minimal invoice projection the detector needs. `dueDate` is an ISO
 * `YYYY-MM-DD` date string, matching the `invoices.due_date` column.
 */
export interface DetectionInvoice {
  id: string;
  userId: string;
  status: Status;
  dueDate: string;
}

/**
 * Database port for overdue detection. All persistence goes through this
 * interface so the job runs against an in-memory fake in tests — no live
 * Postgres. The Supabase-backed implementation is
 * {@link SupabaseOverdueDetectionStore}.
 */
export interface OverdueDetectionStore {
  /**
   * Loads every invoice across all users. This is a background job that acts on
   * behalf of many users, so the production implementation uses the service-role
   * client (which bypasses RLS).
   */
  loadAllInvoices(): Promise<DetectionInvoice[]>;

  /**
   * Persists the `sent` -> `overdue` transition for one invoice (Req 7.2).
   * Implementations MUST make the write conditional on the row still being
   * `sent` and scope it explicitly by `user_id`, so re-running is a no-op and no
   * other user's data is touched.
   */
  markOverdue(invoiceId: string, userId: string): Promise<void>;
}

/** A single follow-up drafting job enqueued for an overdue invoice. */
export interface DraftJob {
  invoiceId: string;
  userId: string;
  /** Days_Overdue derived for this pass (first day after the due date = 1). */
  daysOverdue: number;
}

/**
 * Sink for eligible overdue invoices. In production it invokes the draft worker;
 * in tests it records the jobs. May be sync or async; a rejected/thrown enqueue
 * for one invoice is reported via {@link OverdueDetectionSummary.enqueueErrors}
 * and never aborts the rest of the pass.
 */
export type EnqueueDraft = (job: DraftJob) => void | Promise<void>;

/** Dependencies for {@link runOverdueDetection}. */
export interface OverdueDetectionDeps {
  /** Database port (see {@link SupabaseOverdueDetectionStore} for production). */
  store: OverdueDetectionStore;
  /** Sink for overdue invoices needing a draft attempt. */
  enqueueDraft: EnqueueDraft;
  /** Clock used to evaluate transitions. Defaults to `() => new Date()`. */
  now?: () => Date;
}

/** Outcome of one {@link runOverdueDetection} pass. */
export interface OverdueDetectionSummary {
  /** Total invoices evaluated this pass. */
  evaluated: number;
  /** Invoices transitioned `sent` -> `overdue` (and persisted) this pass. */
  transitioned: number;
  /** Overdue invoices enqueued for drafting this pass. */
  enqueued: number;
  /** Errors from individual enqueue calls, keyed by invoice id. */
  enqueueErrors: Array<{ invoiceId: string; error: unknown }>;
}

/**
 * Runs one full Overdue_Detector pass over every invoice (Req 7.1).
 *
 * For each invoice it computes the next status with the pure
 * {@link evaluateOverdueTransition}; when that differs from the stored status
 * (only ever `sent` -> `overdue`) it persists the transition. Every invoice that
 * is `overdue` after evaluation has its Days_Overdue recomputed via the pure
 * {@link computeDaysOverdue} and is enqueued for drafting. Returns a summary of
 * what happened. Idempotent: a second pass in the same calendar window persists
 * nothing further (see module docs).
 */
export async function runOverdueDetection(
  deps: OverdueDetectionDeps,
): Promise<OverdueDetectionSummary> {
  const now = deps.now ?? (() => new Date());
  const currentDate = now();

  const invoices = await deps.store.loadAllInvoices();

  const summary: OverdueDetectionSummary = {
    evaluated: invoices.length,
    transitioned: 0,
    enqueued: 0,
    enqueueErrors: [],
  };

  for (const invoice of invoices) {
    const nextStatus = evaluateOverdueTransition(
      invoice.status,
      invoice.dueDate,
      currentDate,
    );

    // Persist only a real transition; re-runs on an already-overdue invoice are
    // a no-op because evaluateOverdueTransition only acts on `sent` (Req 7.2).
    if (nextStatus !== invoice.status) {
      await deps.store.markOverdue(invoice.id, invoice.userId);
      summary.transitioned += 1;
    }

    // Recompute Days_Overdue (derived, not stored) and enqueue every overdue
    // invoice for drafting; the guarded drafter decides whether to draft.
    if (nextStatus === 'overdue') {
      const daysOverdue = computeDaysOverdue(invoice.dueDate, currentDate);
      try {
        await deps.enqueueDraft({
          invoiceId: invoice.id,
          userId: invoice.userId,
          daysOverdue,
        });
        summary.enqueued += 1;
      } catch (error) {
        // One failed enqueue must not abort the rest of the daily pass.
        summary.enqueueErrors.push({ invoiceId: invoice.id, error });
      }
    }
  }

  return summary;
}

/** How often the schedule runs, in milliseconds: once per calendar day. */
export const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** A running schedule that can be stopped (e.g. on graceful shutdown). */
export interface ScheduleHandle {
  /** Cancels the schedule so no further runs are triggered. */
  stop(): void;
}

/** Options for {@link startOverdueDetectionSchedule}. */
export interface ScheduleOptions {
  /** Interval between runs. Defaults to {@link DAILY_INTERVAL_MS} (Req 7.1). */
  intervalMs?: number;
  /** Run once immediately on start (before the first interval). Default true. */
  runImmediately?: boolean;
  /** Called with the summary after each successful run. */
  onComplete?: (summary: OverdueDetectionSummary) => void;
  /** Called when a run throws. Defaults to logging via `console.error`. */
  onError?: (error: unknown) => void;
}

/**
 * Schedules {@link runOverdueDetection} to run at least once per calendar day
 * (Req 7.1).
 *
 * Uses a plain `setInterval`; the repository has no cron dependency (see
 * package.json), so a fixed daily interval is used. It fires an initial run
 * immediately (unless `runImmediately` is false) and then every `intervalMs`.
 * Overlapping runs are prevented: if a run is still in progress when the next
 * tick fires, that tick is skipped rather than starting a concurrent pass.
 *
 * NOTE: a `setInterval`-based schedule runs relative to process start, not at a
 * fixed wall-clock time; if the process restarts frequently a wall-clock cron
 * (e.g. Railway cron invoking this function) would be preferable. The
 * at-least-daily guarantee holds for a long-lived process.
 */
export function startOverdueDetectionSchedule(
  deps: OverdueDetectionDeps,
  options: ScheduleOptions = {},
): ScheduleHandle {
  const intervalMs = options.intervalMs ?? DAILY_INTERVAL_MS;
  const runImmediately = options.runImmediately ?? true;
  const onError =
    options.onError ??
    ((error: unknown) => {
      console.error('[overdue-detection] run failed:', error);
    });

  let running = false;

  const tick = async (): Promise<void> => {
    if (running) {
      // A previous pass is still running; skip this tick to avoid overlap.
      return;
    }
    running = true;
    try {
      const summary = await runOverdueDetection(deps);
      options.onComplete?.(summary);
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  };

  if (runImmediately) {
    void tick();
  }

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}

/** Shape of an invoice row selected for overdue detection. */
interface DetectionInvoiceRow {
  id: string;
  user_id: string;
  status: Status;
  due_date: string;
}

/**
 * Supabase-backed {@link OverdueDetectionStore} for the background cron.
 *
 * Uses the service-role client (which bypasses RLS) since it evaluates invoices
 * across all users; the `markOverdue` write is conditional on the row still
 * being `sent` and scoped explicitly by `user_id`, keeping the pass idempotent
 * and per-user safe.
 */
export class SupabaseOverdueDetectionStore implements OverdueDetectionStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async loadAllInvoices(): Promise<DetectionInvoice[]> {
    const { data, error } = await this.supabase
      .from('invoices')
      .select('id, user_id, status, due_date');

    if (error) {
      throw new Error(`Failed to load invoices for overdue detection: ${error.message}`);
    }

    return (data ?? []).map((row: DetectionInvoiceRow) => ({
      id: row.id,
      userId: row.user_id,
      status: row.status,
      dueDate: row.due_date,
    }));
  }

  async markOverdue(invoiceId: string, userId: string): Promise<void> {
    // Conditional on status = 'sent': makes the write idempotent and race-safe.
    const { error } = await this.supabase
      .from('invoices')
      .update({ status: 'overdue' })
      .eq('id', invoiceId)
      .eq('user_id', userId)
      .eq('status', 'sent');

    if (error) {
      throw new Error(
        `Failed to mark invoice ${invoiceId} overdue: ${error.message}`,
      );
    }

    // Log the "Became Overdue" timeline event (best-effort: a logging failure
    // must never fail the transition itself, which has already been persisted).
    try {
      await this.supabase.from('activity_events').insert({
        user_id: userId,
        invoice_id: invoiceId,
        type: 'invoice_became_overdue',
      });
    } catch {
      // Timeline logging is best-effort.
    }
  }
}

/** Connection + model settings for the production overdue-detection wiring. */
export interface OverdueDetectionConfig extends BackgroundClientConfig {
  /** Google Generative AI key for the draft worker (Req 8.7). */
  googleApiKey: string;
}

/**
 * Builds production {@link OverdueDetectionDeps} wired to Supabase (service role)
 * and the Gemini-backed draft worker. The enqueue sink invokes `draftFollowUp`
 * directly; the worker's own guards keep drafting idempotent. Kept separate from
 * the job logic so tests can inject fakes instead.
 */
export function createSupabaseOverdueDetectionDeps(
  config: OverdueDetectionConfig,
): OverdueDetectionDeps {
  const supabase = createBackgroundSupabaseClient(config);
  const store = new SupabaseOverdueDetectionStore(supabase);
  const draftStore = new SupabaseDraftStore(supabase);
  const model = createGeminiModel(config.googleApiKey);

  return {
    store,
    enqueueDraft: async ({ invoiceId }) => {
      await draftFollowUp(invoiceId, { store: draftStore, model });
    },
  };
}
