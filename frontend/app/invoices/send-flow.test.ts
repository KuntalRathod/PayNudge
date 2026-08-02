import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, apiPost, type ApiResult } from '@/lib/api/client';
import type { InvoiceDetail, InvoiceResponse } from './types';

/**
 * Integration smoke test for the SEND-INVOICE flow (task 15.6, Req 4.1).
 *
 * A live Express backend and Supabase session are not available in this test
 * environment, and the current Vitest config uses the `node` environment (no
 * jsdom), so the React `InvoiceDetailView` component cannot be rendered here.
 * Instead we drive the flow end to end through the SHARED api client
 * (`lib/api/client.ts`) with `fetch` mocked — the exact call the invoice detail
 * "Send invoice" action makes:
 *
 *     apiPost<InvoiceResponse>(`/invoices/${id}/send`)
 *
 * These smoke tests assert the two things the flow depends on:
 *   1. The request that reaches the backend is a POST to `/invoices/:id/send`
 *      carrying the Supabase JWT as a Bearer token (authenticated send, Req 4.1).
 *   2. The `ApiResult` the component branches on drives the right UI outcome:
 *      a success resolves to the "sent" invoice (which the view shows as
 *      "Invoice sent." and re-renders with the new status), while a backend
 *      rejection surfaces the backend message as an inline error.
 *
 * The success/error branch reducer below mirrors the component's `handleSend`
 * logic so the assertion documents the flow the client wires up.
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

/** A draft invoice as returned by `GET /invoices/:id` before sending. */
function draftInvoice(): InvoiceDetail {
  return {
    id: 'inv-1',
    user_id: 'user-1',
    client_id: 'client-1',
    invoice_number: 1001,
    amount: '250.00',
    description: 'Design work',
    due_date: '2025-01-31',
    status: 'draft',
    created_at: '2025-01-01T00:00:00.000Z',
    client: { id: 'client-1', name: 'Acme', email: 'ap@acme.test', company: 'Acme Inc' },
  };
}

/**
 * The UI state the invoice detail view lands in after a send. Mirrors the
 * `handleSend` branches: a success sets a confirmation message and swaps in the
 * updated invoice; a failure surfaces the backend error.
 */
type SendOutcome =
  | { kind: 'sent'; message: string; invoice: InvoiceDetail }
  | { kind: 'error'; error: string };

function reduceSend(result: ApiResult<InvoiceResponse>): SendOutcome {
  if (!result.ok) {
    return { kind: 'error', error: result.error };
  }
  return { kind: 'sent', message: 'Invoice sent.', invoice: result.data.invoice };
}

describe('send-invoice flow (Req 4.1)', () => {
  it('POSTs to /invoices/:id/send with the Bearer token and marks the invoice sent', async () => {
    const sent: InvoiceDetail = { ...draftInvoice(), status: 'sent' };
    fetchMock.mockResolvedValue(
      makeResponse(JSON.stringify({ invoice: sent } satisfies InvoiceResponse), {
        ok: true,
        status: 200,
      }),
    );

    const result = await apiPost<InvoiceResponse>('/invoices/inv-1/send', undefined, {
      tokenProvider,
    });

    // 1. The request contract the backend send endpoint requires.
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/invoices/inv-1/send`);
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer session-jwt');

    // 2. The outcome the invoice detail view renders.
    const outcome = reduceSend(result);
    expect(outcome).toEqual({
      kind: 'sent',
      message: 'Invoice sent.',
      invoice: { ...draftInvoice(), status: 'sent' },
    });
  });

  it('surfaces the backend message when sending a non-draft invoice is rejected (Req 4.6)', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(JSON.stringify({ message: 'Invoice is already sent.' }), {
        ok: false,
        status: 409,
      }),
    );

    const result = await apiPost<InvoiceResponse>('/invoices/inv-1/send', undefined, {
      tokenProvider,
    });

    const outcome = reduceSend(result);
    expect(outcome).toEqual({ kind: 'error', error: 'Invoice is already sent.' });
  });

  it('surfaces a delivery-failure message when the send fails (Req 4.4)', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(JSON.stringify({ message: 'Invoice email could not be delivered.' }), {
        ok: false,
        status: 502,
      }),
    );

    const result = await apiPost<InvoiceResponse>('/invoices/inv-1/send', undefined, {
      tokenProvider,
    });

    expect(reduceSend(result)).toEqual({
      kind: 'error',
      error: 'Invoice email could not be delivered.',
    });
  });
});
