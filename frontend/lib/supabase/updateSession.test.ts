import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Integration test for the Next.js middleware route guard (Req 1.7, 1.8).
 *
 * `updateSession` drives session refresh and the redirect-when-unauthenticated
 * behavior. A live Supabase instance is unavailable here, so `@supabase/ssr`'s
 * `createServerClient` is mocked to control what `auth.getUser()` returns:
 *
 *   - no user  → unauthenticated (simulates a logged-out or expired session)
 *   - a user   → authenticated
 *
 * We assert that unauthenticated requests to protected routes are redirected to
 * `/login` (Req 1.7), that after logout the same redirect applies (Req 1.8),
 * that a `redirectTo` hint is preserved, and that authenticated or public
 * requests pass through.
 */

const getUserMock = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
  })),
}));

// Imported after the mock is registered so the mocked module is used.
let updateSession: typeof import('./middleware').updateSession;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  ({ updateSession } = await import('./middleware'));
});

beforeEach(() => {
  getUserMock.mockReset();
});

/** Simulates an unauthenticated (or logged-out) session. */
function asAnonymous() {
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });
}

/** Simulates an authenticated session. */
function asAuthenticated() {
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
}

describe('updateSession route guard', () => {
  it('redirects an unauthenticated request for a protected route to /login (Req 1.7)', async () => {
    asAnonymous();
    const request = new NextRequest('http://localhost/dashboard');

    const response = await updateSession(request);

    expect(response.status).toBe(307);
    const location = response.headers.get('location')!;
    expect(new URL(location).pathname).toBe('/login');
  });

  it('preserves the originally requested path as a redirectTo hint (Req 1.7)', async () => {
    asAnonymous();
    const request = new NextRequest('http://localhost/clients/123');

    const response = await updateSession(request);

    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('redirectTo')).toBe('/clients/123');
  });

  it('redirects to /login after logout clears the session on a protected route (Req 1.8)', async () => {
    // Post-logout there is no user, so the guard treats the request as
    // unauthenticated and redirects.
    asAnonymous();
    const request = new NextRequest('http://localhost/invoices');

    const response = await updateSession(request);

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
  });

  it('does not redirect an authenticated request for a protected route (Req 1.7)', async () => {
    asAuthenticated();
    const request = new NextRequest('http://localhost/dashboard');

    const response = await updateSession(request);

    // Passes through (NextResponse.next()), so no redirect Location is set.
    expect(response.headers.get('location')).toBeNull();
  });

  it('does not redirect an unauthenticated request for a public route (Req 1.7)', async () => {
    asAnonymous();
    const request = new NextRequest('http://localhost/login');

    const response = await updateSession(request);

    expect(response.headers.get('location')).toBeNull();
  });
});
