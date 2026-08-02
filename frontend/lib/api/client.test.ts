import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, apiDelete, apiGet, apiPost, apiPut } from './client';

/**
 * Unit tests for the shared backend API client.
 *
 * These validate the contract that later UI tasks (15.2–15.5) depend on:
 *   - the Supabase JWT is attached as a Bearer token when present,
 *   - JSON bodies are serialized with the right content type,
 *   - success responses resolve to `{ ok: true, data }`,
 *   - error responses surface the backend message as `{ ok: false, error }`,
 *   - network failures degrade gracefully.
 *
 * `fetch` is mocked and a token provider is injected, so no live session or
 * backend is required.
 */

const fetchMock = vi.fn();
const tokenProvider = vi.fn(async (): Promise<string | null> => 'test-jwt');

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  tokenProvider.mockReset();
  tokenProvider.mockResolvedValue('test-jwt');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Builds a minimal Response-like object for the mocked fetch. */
function makeResponse(body: string, init: { ok: boolean; status: number }): Response {
  return {
    ok: init.ok,
    status: init.status,
    text: async () => body,
  } as unknown as Response;
}

describe('apiGet', () => {
  it('attaches the Bearer token and returns parsed JSON on success', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(JSON.stringify([{ id: '1' }]), { ok: true, status: 200 }),
    );

    const result = await apiGet<{ id: string }[]>('/clients', { tokenProvider });

    expect(result).toEqual({ ok: true, data: [{ id: '1' }], status: 200 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/clients`);
    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe('Bearer test-jwt');
  });

  it('omits the Authorization header when no token is available', async () => {
    tokenProvider.mockResolvedValue(null);
    fetchMock.mockResolvedValue(makeResponse('{}', { ok: true, status: 200 }));

    await apiGet('/dashboard', { tokenProvider });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('returns an error result with the backend message on a non-OK response', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(JSON.stringify({ message: 'Invoice not available' }), {
        ok: false,
        status: 404,
      }),
    );

    const result = await apiGet('/invoices/missing', { tokenProvider });

    expect(result).toEqual({ ok: false, error: 'Invoice not available', status: 404 });
  });

  it('degrades gracefully on a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await apiGet('/clients', { tokenProvider });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.error).toBeTruthy();
    }
  });
});

describe('apiPost / apiPut', () => {
  it('serializes the body and sets the JSON content type', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(JSON.stringify({ id: 'c1' }), { ok: true, status: 201 }),
    );

    const result = await apiPost<{ id: string }>(
      '/clients',
      { name: 'Acme', email: 'a@b.com' },
      { tokenProvider },
    );

    expect(result).toEqual({ ok: true, data: { id: 'c1' }, status: 201 });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.body).toBe(JSON.stringify({ name: 'Acme', email: 'a@b.com' }));
  });

  it('sends a PUT with the correct method', async () => {
    fetchMock.mockResolvedValue(makeResponse(JSON.stringify({ id: 'c1' }), { ok: true, status: 200 }));

    await apiPut('/clients/c1', { name: 'New' }, { tokenProvider });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('PUT');
  });
});

describe('apiDelete', () => {
  it('handles an empty 204 response as undefined data', async () => {
    fetchMock.mockResolvedValue(makeResponse('', { ok: true, status: 204 }));

    const result = await apiDelete('/invoices/i1', { tokenProvider });

    expect(result).toEqual({ ok: true, data: undefined, status: 204 });
  });
});
