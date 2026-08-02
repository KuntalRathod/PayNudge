/**
 * Email_Service — Resend integration wrapper (Requirements 4.1, 4.4, 4.5).
 *
 * This module delivers emails through Resend under a bounded timeout and
 * reports the outcome as an explicit, testable delivery signal:
 *
 *   - Confirmed delivery within the timeout  -> `{ ok: true, id }`.
 *   - Resend returns a delivery error        -> `{ ok: false, reason: 'delivery_error' }`.
 *   - The SDK call throws (network, etc.)     -> `{ ok: false, reason: 'delivery_error' }`.
 *   - No confirmation within the timeout      -> `{ ok: false, reason: 'timeout' }`.
 *
 * The service deliberately RESOLVES with a delivery-failure signal rather than
 * rejecting, so callers (the guarded send endpoint in Task 6.4 and the
 * follow-up delivery flow in Task 12.7) can branch on the result without
 * try/catch and cannot leave an unhandled rejection. The Resend client is
 * INJECTED, and the timeout is configurable, so unit tests exercise every
 * branch (success, error, throw, timeout) without any network calls.
 */

import type {
  CreateEmailOptions,
  CreateEmailRequestOptions,
  CreateEmailResponse,
} from 'resend';

/**
 * Default delivery-confirmation window. Requirements 4.1/4.4/4.5 (and the
 * mirrored follow-up requirement 9.9) all bound delivery at 30 seconds.
 */
export const DEFAULT_EMAIL_TIMEOUT_MS = 30_000;

/**
 * A single outbound email. `html` and `text` are both optional individually,
 * but at least one body should be supplied for a meaningful message.
 */
export interface EmailMessage {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | string[];
  /**
   * Optional file attachments (e.g. the invoice PDF). Resend accepts
   * attachment content as a base64-encoded string or a raw `Buffer`; either
   * is passed through unchanged to the SDK.
   */
  attachments?: EmailAttachment[];
}

/** A single email attachment. */
export interface EmailAttachment {
  /** The filename shown to the recipient (e.g. `"invoice-42.pdf"`). */
  filename: string;
  /** File content as a `Buffer` or a base64-encoded string. */
  content: Buffer | string;
}

/**
 * The delivery-failure signal returned on a delivery error or timeout.
 *
 * - `delivery_error` — Resend reported an error, or the SDK call threw
 *   (Requirement 4.4).
 * - `timeout` — delivery was not confirmed within the timeout window
 *   (Requirement 4.5).
 */
export interface EmailDeliveryFailure {
  ok: false;
  reason: 'delivery_error' | 'timeout';
  message: string;
}

/** Confirmed-delivery result carrying the Resend message id (Requirement 4.1). */
export interface EmailDeliverySuccess {
  ok: true;
  id: string;
}

/** Discriminated union describing the outcome of a send attempt. */
export type EmailDeliveryResult = EmailDeliverySuccess | EmailDeliveryFailure;

/** Per-call overrides for {@link EmailService.sendEmail}. */
export interface SendEmailOptions {
  /** Overrides the service default confirmation window, in milliseconds. */
  timeoutMs?: number;
}

/**
 * The minimal structural slice of the Resend client this wrapper depends on.
 * A real `Resend` instance satisfies this interface, and tests can supply a
 * lightweight fake — keeping the client fully injectable.
 */
export interface EmailSendClient {
  emails: {
    send(
      payload: CreateEmailOptions,
      options?: CreateEmailRequestOptions,
    ): Promise<CreateEmailResponse>;
  };
}

/** The Email_Service surface consumed by the invoice/follow-up flows. */
export interface EmailService {
  sendEmail(
    message: EmailMessage,
    options?: SendEmailOptions,
  ): Promise<EmailDeliveryResult>;
}

/** Options for {@link createEmailService}. */
export interface CreateEmailServiceOptions {
  /**
   * Default delivery-confirmation window in milliseconds. Injectable so tests
   * can drive the timeout branch quickly. Defaults to
   * {@link DEFAULT_EMAIL_TIMEOUT_MS} (30s).
   */
  timeoutMs?: number;
}

interface TimeoutRace<T> {
  timedOut: boolean;
  value?: T;
}

/**
 * Races a promise against a timeout. Resolves `{ timedOut: false, value }` if
 * the promise settles first, or `{ timedOut: true }` if the timer fires first.
 * Rejections propagate so the caller can classify them as delivery errors. The
 * timer is always cleared to avoid dangling handles.
 */
function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<TimeoutRace<T>> {
  return new Promise<TimeoutRace<T>>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ timedOut: true });
      }
    }, timeoutMs);

    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ timedOut: false, value });
        }
      },
      (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
  });
}

/** Best-effort extraction of a human-readable message from an unknown throw. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown email delivery error';
}

function toPayload(message: EmailMessage): CreateEmailOptions {
  const payload: Record<string, unknown> = {
    from: message.from,
    to: message.to,
    subject: message.subject,
  };

  if (message.html !== undefined) {
    payload.html = message.html;
  }
  if (message.text !== undefined) {
    payload.text = message.text;
  }
  if (message.replyTo !== undefined) {
    payload.replyTo = message.replyTo;
  }
  if (message.attachments !== undefined) {
    payload.attachments = message.attachments;
  }

  // Resend types `CreateEmailOptions` as requiring at least one render option
  // (html/text/react). Callers supply html and/or text; the cast bridges the
  // structural gap without loosening the public `EmailMessage` contract.
  return payload as unknown as CreateEmailOptions;
}

/**
 * Creates an {@link EmailService} bound to an injected Resend-compatible
 * client. Delivery outcomes are reported as an {@link EmailDeliveryResult};
 * the returned promise never rejects for delivery errors or timeouts.
 */
export function createEmailService(
  client: EmailSendClient,
  options: CreateEmailServiceOptions = {},
): EmailService {
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_EMAIL_TIMEOUT_MS;

  return {
    async sendEmail(
      message: EmailMessage,
      sendOptions: SendEmailOptions = {},
    ): Promise<EmailDeliveryResult> {
      const timeoutMs = sendOptions.timeoutMs ?? defaultTimeoutMs;

      let race: TimeoutRace<CreateEmailResponse>;
      try {
        race = await raceWithTimeout(client.emails.send(toPayload(message)), timeoutMs);
      } catch (error) {
        // SDK threw (network failure, misconfiguration, etc.) -> Req 4.4.
        return { ok: false, reason: 'delivery_error', message: describeError(error) };
      }

      if (race.timedOut) {
        // No confirmation within the window -> Req 4.5.
        return {
          ok: false,
          reason: 'timeout',
          message: `Email delivery was not confirmed within ${timeoutMs}ms`,
        };
      }

      const response = race.value as CreateEmailResponse;
      if (response.error !== null || response.data === null) {
        // Resend reported a delivery error -> Req 4.4.
        return {
          ok: false,
          reason: 'delivery_error',
          message: response.error?.message ?? 'Resend returned no delivery confirmation',
        };
      }

      // Confirmed delivery -> Req 4.1.
      return { ok: true, id: response.data.id };
    },
  };
}

/**
 * Convenience integration factory: constructs a real Resend client from an
 * API key (e.g. `getConfig().RESEND_API_KEY`) and wraps it in an
 * {@link EmailService}. Production code uses this; unit tests should prefer
 * {@link createEmailService} with a fake client so no network call is made.
 */
export async function createResendEmailService(
  apiKey: string,
  options: CreateEmailServiceOptions = {},
): Promise<EmailService> {
  const { Resend } = await import('resend');
  return createEmailService(new Resend(apiKey), options);
}
