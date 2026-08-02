/**
 * Follow-up state-transition logic and content-edit validation (pure logic).
 *
 * Requirements 9.3, 9.4, 9.5, 9.10, 9.11.
 *
 * Framework-free, side-effect-free logic for the human-in-the-loop follow-up
 * approval flow. The three user actions — edit, approve, and discard — are only
 * valid while a follow-up is in `pending_approval` status. For a follow-up in
 * any other status (`approved`, `sent`, `discarded`) every action is rejected
 * and the status is left unchanged (Req 9.11).
 *
 * State transitions (only from `pending_approval`):
 *   - approve : pending_approval → approved                    (Req 9.5)
 *   - discard : pending_approval → discarded                   (Req 9.10)
 *   - edit    : pending_approval → pending_approval, content   (Req 9.3, 9.4)
 *               replaced when the new content is valid
 *
 * Content-edit validation (Req 9.3, 9.4): edited content must be non-empty and
 * at most {@link MAX_CONTENT_LENGTH} characters. An empty edit or one exceeding
 * the bound is rejected with a code identifying the content-length violation,
 * and the existing content is retained.
 *
 * Everything here is pure and deterministic: functions never mutate their
 * inputs and have no side effects, so a rejected action leaves any stored
 * record untouched. Properties 17 (approval gate), 19 (content edits
 * round-trip), and 21 (non-pending rejection) validate this module.
 */

/** The lifecycle status of a follow-up (Follow_Up_Status). */
export type FollowUpStatus = 'pending_approval' | 'approved' | 'sent' | 'discarded';

/** Inclusive maximum length (characters) for edited follow-up content. */
export const MAX_CONTENT_LENGTH = 10_000;

/**
 * Machine-readable reason an action was rejected:
 *   - `NOT_PENDING`      : the follow-up was not in `pending_approval` status.
 *   - `CONTENT_EMPTY`    : the edited content was empty.
 *   - `CONTENT_TOO_LONG` : the edited content exceeded {@link MAX_CONTENT_LENGTH}.
 */
export type FollowUpFailureCode = 'NOT_PENDING' | 'CONTENT_EMPTY' | 'CONTENT_TOO_LONG';

/** Discriminated failure result. The caller leaves stored state unchanged. */
export interface FollowUpFailure {
  ok: false;
  code: FollowUpFailureCode;
  message: string;
}

/**
 * Discriminated success result. `status` is the follow-up's status after the
 * action. `content` is present only for a successful edit and carries the
 * validated replacement content.
 */
export interface FollowUpSuccess {
  ok: true;
  status: FollowUpStatus;
  content?: string;
}

/** Discriminated union returned by the transition functions. */
export type FollowUpResult = FollowUpSuccess | FollowUpFailure;

/** Discriminated result of content-only validation. */
export type ContentValidationResult =
  | { ok: true; content: string }
  | FollowUpFailure;

/** The user actions that may be applied to a follow-up. */
export type FollowUpAction =
  | { type: 'edit'; content: unknown }
  | { type: 'approve' }
  | { type: 'discard' };

const PENDING: FollowUpStatus = 'pending_approval';

function notPending(): FollowUpFailure {
  return {
    ok: false,
    code: 'NOT_PENDING',
    message: 'The follow-up is not pending approval.',
  };
}

/**
 * Validates edited follow-up content (Req 9.3, 9.4).
 *
 * Content is valid when it is a non-empty string of at most
 * {@link MAX_CONTENT_LENGTH} characters. The content is returned unchanged on
 * success so an accepted edit round-trips exactly (Property 19); it is not
 * trimmed or otherwise rewritten. Non-string input is treated as empty.
 */
export function validateFollowUpContent(content: unknown): ContentValidationResult {
  if (typeof content !== 'string' || content.length === 0) {
    return {
      ok: false,
      code: 'CONTENT_EMPTY',
      message: 'Follow-up content cannot be empty.',
    };
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return {
      ok: false,
      code: 'CONTENT_TOO_LONG',
      message: `Follow-up content must be at most ${MAX_CONTENT_LENGTH} characters.`,
    };
  }
  return { ok: true, content };
}

/**
 * Edits a follow-up's content (Req 9.3, 9.4, 9.11).
 *
 * Allowed only while the follow-up is `pending_approval`; from any other status
 * the edit is rejected with `NOT_PENDING` and the content is unchanged. When
 * allowed, the new content is validated: an invalid edit is rejected (existing
 * content retained) and a valid edit keeps the status `pending_approval` while
 * carrying the replacement content.
 */
export function editFollowUp(
  currentStatus: FollowUpStatus,
  newContent: unknown,
): FollowUpResult {
  if (currentStatus !== PENDING) {
    return notPending();
  }
  const validated = validateFollowUpContent(newContent);
  if (!validated.ok) {
    return validated;
  }
  return { ok: true, status: PENDING, content: validated.content };
}

/**
 * Approves a follow-up (Req 9.5, 9.11): `pending_approval` → `approved`. From
 * any other status the action is rejected and the status is unchanged.
 */
export function approveFollowUp(currentStatus: FollowUpStatus): FollowUpResult {
  if (currentStatus !== PENDING) {
    return notPending();
  }
  return { ok: true, status: 'approved' };
}

/**
 * Discards a follow-up (Req 9.10, 9.11): `pending_approval` → `discarded`. From
 * any other status the action is rejected and the status is unchanged.
 */
export function discardFollowUp(currentStatus: FollowUpStatus): FollowUpResult {
  if (currentStatus !== PENDING) {
    return notPending();
  }
  return { ok: true, status: 'discarded' };
}

/**
 * Pure reducer applying a {@link FollowUpAction} to a follow-up's current
 * status (and current content, needed by callers to retain content on a
 * rejected edit). Dispatches to {@link editFollowUp}, {@link approveFollowUp},
 * or {@link discardFollowUp}. The reducer never mutates its arguments.
 */
export function applyFollowUpAction(
  currentStatus: FollowUpStatus,
  action: FollowUpAction,
): FollowUpResult {
  switch (action.type) {
    case 'edit':
      return editFollowUp(currentStatus, action.content);
    case 'approve':
      return approveFollowUp(currentStatus);
    case 'discard':
      return discardFollowUp(currentStatus);
    default: {
      // Exhaustiveness guard: unreachable for well-typed callers.
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
