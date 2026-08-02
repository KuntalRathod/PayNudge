import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Integration test for the logout route handler (Req 1.8).
 *
 * The route terminates the Supabase session and redirects to `/login`. The
 * server-side Supabase client is mocked so we can assert that an active session
 * is signed out and that the response redirects to the login view. Whether a
 * cleared session cookie actually blocks future requests is covered by the
 * middleware guard test (`updateSession.test.ts`); here we validate the route's
 * own contract.
 */

const getUserMock = vi.fn();
const signOutMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: getUserMock,
      signOut: signOutMock,
    },
  })),
}));

let POST: typeof import('./route').POST;

beforeEach(async () => {
  getUserMock.mockReset();
  signOutMock.mockReset();
  signOutMock.mockResolvedValue({ error: null });
  ({ POST } = await import('./route'));
});

describe('logout route', () => {
  it('signs out an active session and redirects to /login (Req 1.8)', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    const request = new NextRequest('http://localhost/auth/logout', { method: 'POST' });

    const response = await POST(request);

    expect(signOutMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
  });

  it('redirects to /login even when there is no active session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const request = new NextRequest('http://localhost/auth/logout', { method: 'POST' });

    const response = await POST(request);

    expect(signOutMock).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
  });
});
