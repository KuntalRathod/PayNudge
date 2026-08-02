import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, apiPost, type ApiResult } from '@/lib/api/client';
import type { FollowUpActionResponse } from './types';

/**
 * Integration smoke test for the APPROVE-FOLLOW-UP flow (task 15.6, Req 9.6).
 *
 * As with the send-invoice smoke test, no live backend/session is available and
 * the Vitest `node` environment cannot render the React `FollowUpCard`. We drive
 * the flow end to end through the SHARED api client with `fetch` mocked — the
 * exact call the card's "Approve & send" action makes:
 *
 *     apiPost<FollowUpActionResponse>(`/follow-ups/${id}/approve`)
 *
 * Approving a pending follow-up is what transitions it to "approved", and it is
 * that transition the backend then acts on to deliver the email (Req 9.6). From
 * the frontend the flow's contract is: POST the approve action with the Bearer
 * token, and on success drop the item from the pending list (`onResolved(id,
 * 'approved')`); on a backend rejection keep the item and show the message
 * inline (e.g. the follow-up is no longer pending, Req 9.11).
 *
 * The reducer below mirrors the card's `approve` handler branches.
 */

const fetchMock = vi.fn();
const tokenProvider = vi.fn(async (): Promise<string | null> => 'session-jwt');

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  tokenProvider.mockReset();
  tokenProvider.mockResolvedValue('session-jwt');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Minimal Response-like object for the mocked fetch (mirrors client.test.ts). */
function makeResponse(body: string, init: { ok: boolean; status: number }): Response {
  return {
    ok: init.ok,
    status: init.status,
    text: async () => body,
  } as unknown as Response;
}

/** The `follow_up` payload returned by `POST /follow-ups/:id/approve`. */
function approvedFollowUp(): FollowUpActionResponse {
  return {
    follow_up: {
      id: 'fu-1',
      invoice_id: 'inv-1',
      tier: 'polite',
      content: 'A gentle reminder about invoice #1001.',
      status: 'approved',
      sent_at: null,
    },
  };
}

/**
 * The card interaction outcome after an approve. Mirrors the `approve` handler:
 * a success resolves the item out of the pending list as 'approved'; a failure
 * keeps it and reports the backend message inline.
 */
type ApproveOutcome =
  | { kind: 'resolved'; id: string; outcome: 'approved' }
  | { kind: 'error'; error: string };

function reduceApprove(
  id: string,
  result: ApiResult<FollowUpActionResponse>,
): ApproveOutcome {
  if (!result.ok) {
    return { kind: 'error', error: result.error };
  }
  return { kind: 'resolved', id, outcome: 'approved' };
}

describe('approve-follow-up flow (Req 9.6)', () => {
  it('POSTs to /follow-ups/:id/approve with the Bearer token and resolves the item as approved', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(JSON.stringify(approvedFollowUp()), { ok: true, status: 200 }),
    );

    const result = await apiPost<FollowUpActionResponse>('/follow-ups/fu-1/approve', undefined, {
      tokenProvider,
    });

    // 1. The request contract the backend approve endpoint requires.
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/follow-ups/fu-1/approve`);
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer session-jwt');

    // 2. The response reflects the "approved" transition (Req 9.6 precondition).
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.follow_up.status).toBe('approved');
    }

    // 3. The card drops the item from the pending list.
    expect(reduceApprove('fu-1', result)).toEqual({
      kind: 'resolved',
      id: 'fu-1',
      outcome: 'approved',
    });
  });

  it('keeps the item and surfaces the backend message when the follow-up is not pending (Req 9.11)', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(JSON.stringify({ message: 'Follow-up is not pending approval.' }), {
        ok: false,
        status: 409,
      }),
    );

    const result = await apiPost<FollowUpActionResponse>('/follow-ups/fu-1/approve', undefined, {
      tokenProvider,
    });

    expect(reduceApprove('fu-1', result)).toEqual({
      kind: 'error',
      error: 'Follow-up is not pending approval.',
    });
  });

  it('surfaces a delivery-failure message when the approved email is not confirmed (Req 9.9)', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(JSON.stringify({ message: 'Follow-up email could not be delivered.' }), {
        ok: false,
        status: 502,
      }),
    );

    const result = await apiPost<FollowUpActionResponse>('/follow-ups/fu-1/approve', undefined, {
      tokenProvider,
    });

    expect(reduceApprove('fu-1', result)).toEqual({
      kind: 'error',
      error: 'Follow-up email could not be delivered.',
    });
  });
});
