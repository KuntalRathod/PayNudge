/**
 * Escalation-tier mapping and escalation-decision logic
 * (Requirements 8.2, 8.3, 8.4, 10.1).
 *
 * PURE, deterministic, side-effect-free functions. No I/O, no database access,
 * no clock reads. This keeps the logic directly property-testable (Tasks
 * 11.2 / 11.3, Properties 14 and 22) and reusable by the AI draft worker.
 *
 * ## Tier mapping (Requirement 8.2–8.4, Property 14)
 *
 * The Escalation_Tier is a total function of Days_Overdue for values >= 1:
 *
 *   - `1 <= days < 7`  -> `polite`
 *   - `7 <= days < 14` -> `firm`
 *   - `days >= 14`     -> `final_notice`
 *
 * ## Behavior for days < 1
 *
 * The tier mapping is only *defined* for Days_Overdue >= 1 (Property 14). An
 * invoice with fewer than one whole day overdue has no meaningful escalation
 * tier, so {@link tierForDaysOverdue} returns `null` for any value < 1
 * (including zero, negatives, and fractional values below 1). This keeps the
 * function total and deterministic while signalling "no tier applies". Callers
 * such as {@link shouldDraft} treat `null` as "do not draft".
 *
 * Non-finite inputs (NaN, Infinity) and fractional values are handled by
 * flooring to whole calendar days first, matching how Days_Overdue is computed
 * elsewhere (Requirement 7.6/7.7: whole calendar days).
 *
 * ## Tier ordering (Requirement 10.1)
 *
 * The tiers form a strict total order from lowest to highest:
 *
 *   `polite < firm < final_notice`
 *
 * {@link tierRank} exposes this order as an integer so tiers can be compared
 * with ordinary numeric comparison.
 */

/** The three escalation tones, lowest to highest severity. */
export type Tier = 'polite' | 'firm' | 'final_notice';

/** Day thresholds (inclusive lower bounds) for each tier. */
export const POLITE_MIN_DAYS = 1;
export const FIRM_MIN_DAYS = 7;
export const FINAL_NOTICE_MIN_DAYS = 14;

/**
 * Rank of each tier in the escalation order (lowest to highest).
 * `polite` (0) < `firm` (1) < `final_notice` (2).
 */
const TIER_RANK: Record<Tier, number> = {
  polite: 0,
  firm: 1,
  final_notice: 2,
};

/**
 * Returns the integer rank of a tier in the escalation order, where a higher
 * number means a more severe tier: `polite` (0) < `firm` (1) <
 * `final_notice` (2).
 */
export function tierRank(tier: Tier): number {
  return TIER_RANK[tier];
}

/**
 * Compares two tiers by escalation order. Returns a negative number when `a`
 * is lower than `b`, zero when equal, and a positive number when `a` is
 * higher. Mirrors the `Array.prototype.sort` comparator contract.
 */
export function compareTiers(a: Tier, b: Tier): number {
  return tierRank(a) - tierRank(b);
}

/**
 * Maps a Days_Overdue value to its Escalation_Tier (Requirements 8.2–8.4).
 *
 * Returns:
 *   - `polite`       when `1 <= days < 7`
 *   - `firm`         when `7 <= days < 14`
 *   - `final_notice` when `days >= 14`
 *   - `null`         when `days < 1` (no tier is defined; see module docs)
 *
 * The input is floored to whole calendar days first. Non-finite inputs (NaN,
 * Infinity, -Infinity) return `null`, keeping the function total.
 */
export function tierForDaysOverdue(daysOverdue: number): Tier | null {
  if (!Number.isFinite(daysOverdue)) {
    return null;
  }

  const days = Math.floor(daysOverdue);

  if (days < POLITE_MIN_DAYS) {
    return null;
  }
  if (days < FIRM_MIN_DAYS) {
    return 'polite';
  }
  if (days < FINAL_NOTICE_MIN_DAYS) {
    return 'firm';
  }
  return 'final_notice';
}

/**
 * Decides whether a new Follow_Up should be drafted for an overdue invoice
 * (Requirement 10.1, Property 22).
 *
 * A new draft is warranted only when the tier mapped to `currentDaysOverdue`
 * is STRICTLY higher (order: polite < firm < final_notice) than the tier of
 * the most recent non-discarded Follow_Up for that invoice.
 *
 * @param currentDaysOverdue         The invoice's current Days_Overdue value.
 * @param mostRecentNonDiscardedTier The tier of the most recent non-discarded
 *   Follow_Up, or `null` when the invoice has no prior non-discarded Follow_Up.
 *
 * @returns `true` iff drafting should proceed:
 *   - `false` when `currentDaysOverdue` maps to no tier (< 1 day overdue),
 *     regardless of prior tier — there is nothing to draft at.
 *   - `true` when there is no prior non-discarded Follow_Up (`null`) and the
 *     current days map to a tier — any tier is an increase from "none".
 *   - otherwise `true` only when the current tier's rank is strictly greater
 *     than the prior tier's rank.
 */
export function shouldDraft(
  currentDaysOverdue: number,
  mostRecentNonDiscardedTier: Tier | null,
): boolean {
  const currentTier = tierForDaysOverdue(currentDaysOverdue);

  // No tier maps to the current days overdue (< 1 day): nothing to draft.
  if (currentTier === null) {
    return false;
  }

  // No prior non-discarded follow-up: any tier is a strict increase from "none".
  if (mostRecentNonDiscardedTier === null) {
    return true;
  }

  // Draft only on a strict tier increase.
  return tierRank(currentTier) > tierRank(mostRecentNonDiscardedTier);
}
