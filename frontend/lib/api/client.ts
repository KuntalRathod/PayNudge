/**
 * Typed API client for the Express backend.
 *
 * This is the SHARED contract that all data-fetching UI (tasks 15.2–15.5)
 * builds on. It centralizes three concerns so feature code never repeats them:
 *
 *   1. Base URL resolution — `NEXT_PUBLIC_API_URL` (defaults to
 *      `http://localhost:4000` for local dev).
 *   2. Authentication — every request carries the current Supabase session's
 *      JWT as an `Authorization: Bearer <token>` header, which the backend
 *      middleware verifies and uses to scope all data access to the user's RLS
 *      context (see design "Request Authentication Flow").
 *   3. Result shape — every call resolves to a discriminated `ApiResult<T>`
 *      (`{ ok: true, data }` or `{ ok: false, error, status }`) so callers
 *      surface backend messages without try/catch boilerplate.
 *
 * HOW LATER TASKS EXTEND THIS:
 *   - Import `apiGet` / `apiPost` / `apiPut` / `apiDelete` and call them with a
 *     path (e.g. `apiGet<Client[]>('/clients')`).
 *   - Define the response/request TypeScript types alongside the feature.
 *   - Narrow on `result.ok` to render data or show `result.error`.
 *   - The token provider is injected (defaults to the browser Supabase client),
 *     which keeps these helpers unit-testable without a live session.
 */
import { createClient } from '@/lib/supabase/client';

/** Base URL of the Express API. Configurable per environment. */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') ?? 'http://localhost:4000';

/** Discriminated result returned by every API helper. */
export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

/** Resolves the current user's access token, or null when unauthenticated. */
export type TokenProvider = () => Promise<string | null>;

/** Options accepted by {@link apiFetch}, minus the method/body we manage. */
export interface ApiRequestOptions {
  /** Parsed JSON request body. Serialized and sent as `application/json`. */
  body?: unknown;
  /** Extra headers merged over the defaults. */
  headers?: Record<string, string>;
  /** Injectable token provider (defaults to the browser Supabase session). */
  tokenProvider?: TokenProvider;
  /** Passed through to `fetch` (e.g. `signal`, `cache`). */
  signal?: AbortSignal;
}

/** Default token provider: reads the JWT from the browser Supabase session. */
export const defaultTokenProvider: TokenProvider = async () => {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
};

/** Generic message used when the backend returns no structured error text. */
const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * Extracts a human-readable error message from a non-OK response body,
 * tolerating both JSON (`{ message | error }`) and plain-text payloads.
 */
function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim().length > 0) {
    return body;
  }
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const message = record.message ?? record.error;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
}

/**
 * Performs an authenticated request to the backend and returns a typed result.
 *
 * On a 2xx response the JSON body is returned as `data` (or `undefined` for an
 * empty 204). On any other status, or a network failure, an `ok: false` result
 * carries the backend's message (or a generic fallback) and the HTTP status
 * (0 for network errors).
 */
export async function apiFetch<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const tokenProvider = options.tokenProvider ?? defaultTokenProvider;
  const token = await tokenProvider();

  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch {
    return { ok: false, error: GENERIC_ERROR, status: 0 };
  }

  // Parse the body once, tolerating empty and non-JSON responses.
  const raw = await response.text();
  let parsed: unknown = undefined;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: extractErrorMessage(parsed, GENERIC_ERROR),
      status: response.status,
    };
  }

  return { ok: true, data: parsed as T, status: response.status };
}

/** GET a resource. */
export function apiGet<T>(path: string, options?: ApiRequestOptions): Promise<ApiResult<T>> {
  return apiFetch<T>('GET', path, options);
}

/** POST a JSON body. */
export function apiPost<T>(
  path: string,
  body?: unknown,
  options?: ApiRequestOptions,
): Promise<ApiResult<T>> {
  return apiFetch<T>('POST', path, { ...options, body });
}

/** PUT a JSON body. */
export function apiPut<T>(
  path: string,
  body?: unknown,
  options?: ApiRequestOptions,
): Promise<ApiResult<T>> {
  return apiFetch<T>('PUT', path, { ...options, body });
}

/** DELETE a resource. */
export function apiDelete<T>(path: string, options?: ApiRequestOptions): Promise<ApiResult<T>> {
  return apiFetch<T>('DELETE', path, options);
}

/**
 * Fetches a binary resource (e.g. a generated PDF) with the same
 * authentication as {@link apiFetch}, returning the raw response instead of
 * a parsed `ApiResult`. `apiFetch` always parses the body as JSON/text, which
 * would corrupt binary content, so downloads use this separate helper.
 *
 * On success, resolves with the `Blob` and the `Content-Disposition`
 * filename (if present). On failure, resolves with `ok: false` and a message
 * (parsed from a JSON/text error body when the backend sent one).
 */
export async function apiDownload(
  path: string,
  options: ApiRequestOptions = {},
): Promise<
  | { ok: true; blob: Blob; filename: string | null }
  | { ok: false; error: string; status: number }
> {
  const tokenProvider = options.tokenProvider ?? defaultTokenProvider;
  const token = await tokenProvider();

  const headers: Record<string, string> = { ...options.headers };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', headers, signal: options.signal });
  } catch {
    return { ok: false, error: GENERIC_ERROR, status: 0 };
  }

  if (!response.ok) {
    const raw = await response.text();
    let parsed: unknown = undefined;
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }
    return {
      ok: false,
      error: extractErrorMessage(parsed, GENERIC_ERROR),
      status: response.status,
    };
  }

  const disposition = response.headers.get('content-disposition');
  const filenameMatch = disposition ? /filename="([^"]+)"/.exec(disposition) : null;

  const blob = await response.blob();
  return { ok: true, blob, filename: filenameMatch?.[1] ?? null };
}
