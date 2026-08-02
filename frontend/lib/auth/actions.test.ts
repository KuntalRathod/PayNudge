import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MESSAGES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  signIn,
  signOut,
  signUp,
  type AuthClientLike,
} from './actions';

/**
 * Integration-style tests for the auth flows (Requirement 1).
 *
 * A live Supabase Auth instance is not available in this environment, so these
 * tests exercise the auth helpers against a MOCKED Supabase Auth client. The
 * mock stands in for `@supabase/supabase-js` / `@supabase/ssr`'s `auth` surface
 * and lets us drive the success and error branches Supabase would return.
 *
 * Limitation: the actual credential storage, password hashing, and session
 * cookie issuance live inside Supabase Auth and can only be validated against a
 * live instance. These tests validate the application-side contract our UI
 * relies on: local validation, duplicate handling, non-disclosing login
 * failures, and session termination.
 */

/** Builds a mocked Supabase auth client with overridable method results. */
function makeAuthClient(overrides?: {
  signUp?: AuthClientLike['auth']['signUp'];
  signInWithPassword?: AuthClientLike['auth']['signInWithPassword'];
  signOut?: AuthClientLike['auth']['signOut'];
}) {
  const signUpFn = vi.fn(
    overrides?.signUp ??
      (async () => ({
        data: { user: { id: 'user-1', identities: [{ id: 'idp-1' }] }, session: {} },
        error: null,
      })),
  );
  const signInWithPasswordFn = vi.fn(
    overrides?.signInWithPassword ?? (async () => ({ data: { session: {} }, error: null })),
  );
  const signOutFn = vi.fn(overrides?.signOut ?? (async () => ({ error: null })));

  const client: AuthClientLike = {
    auth: {
      signUp: signUpFn,
      signInWithPassword: signInWithPasswordFn,
      signOut: signOutFn,
    },
  };
  return { client, signUpFn, signInWithPasswordFn, signOutFn };
}

describe('signUp', () => {
  let client: ReturnType<typeof makeAuthClient>;

  beforeEach(() => {
    client = makeAuthClient();
  });

  it('creates an account and establishes a session for a valid, unused email (Req 1.1)', async () => {
    const result = await signUp(client.client, 'new@example.com', 'goodpassword');

    expect(result).toEqual({ ok: true });
    expect(client.signUpFn).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'goodpassword',
    });
  });

  it('rejects an invalid email format without calling Supabase (Req 1.2)', async () => {
    const result = await signUp(client.client, 'not-an-email', 'goodpassword');

    expect(result).toEqual({ ok: false, message: MESSAGES.invalidEmail });
    expect(client.signUpFn).not.toHaveBeenCalled();
  });

  it('rejects a password shorter than the minimum length (Req 1.3)', async () => {
    const short = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
    const result = await signUp(client.client, 'new@example.com', short);

    expect(result).toEqual({ ok: false, message: MESSAGES.passwordLength });
    expect(client.signUpFn).not.toHaveBeenCalled();
  });

  it('rejects a password longer than the maximum length (Req 1.3)', async () => {
    const long = 'a'.repeat(PASSWORD_MAX_LENGTH + 1);
    const result = await signUp(client.client, 'new@example.com', long);

    expect(result).toEqual({ ok: false, message: MESSAGES.passwordLength });
    expect(client.signUpFn).not.toHaveBeenCalled();
  });

  it('rejects a duplicate email signaled by an explicit error and leaves the account unchanged (Req 1.4)', async () => {
    const dup = makeAuthClient({
      signUp: vi.fn(async () => ({
        data: { user: null, session: null },
        error: { message: 'User already registered', status: 422, code: 'user_already_exists' },
      })),
    });

    const result = await signUp(dup.client, 'existing@example.com', 'goodpassword');

    expect(result).toEqual({ ok: false, message: MESSAGES.emailAlreadyRegistered });
  });

  it('rejects a duplicate email signaled by an empty identities array (Req 1.4)', async () => {
    const dup = makeAuthClient({
      // Supabase returns a user with no identities for an existing email when
      // email confirmation is enabled (anti-enumeration behavior).
      signUp: vi.fn(async () => ({
        data: { user: { id: 'obscured', identities: [] }, session: null },
        error: null,
      })),
    });

    const result = await signUp(dup.client, 'existing@example.com', 'goodpassword');

    expect(result).toEqual({ ok: false, message: MESSAGES.emailAlreadyRegistered });
  });
});

describe('signIn', () => {
  it('establishes a session when credentials match (Req 1.5)', async () => {
    const { client, signInWithPasswordFn } = makeAuthClient();

    const result = await signIn(client, 'user@example.com', 'goodpassword');

    expect(result).toEqual({ ok: true });
    expect(signInWithPasswordFn).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'goodpassword',
    });
  });

  it('returns a non-disclosing failure message that never reveals the wrong field (Req 1.6)', async () => {
    // Supabase returns the same "Invalid login credentials" error whether the
    // email is unknown or the password is wrong. We assert our message is
    // likewise field-agnostic.
    const failing = makeAuthClient({
      signInWithPassword: vi.fn(async () => ({
        data: { session: null },
        error: { message: 'Invalid login credentials', status: 400 },
      })),
    });

    const result = await signIn(failing.client, 'user@example.com', 'wrongpassword');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const lower = result.message.toLowerCase();
      // A symmetric "email or password" phrasing is fine; what must NOT appear
      // is any phrasing that singles out which specific field was wrong.
      expect(lower).not.toMatch(/(wrong|incorrect|invalid|bad) password/);
      expect(lower).not.toMatch(/password (is )?(wrong|incorrect|invalid)/);
      expect(lower).not.toMatch(/email .*(not found|unknown|does not exist|not registered)/);
      expect(lower).not.toMatch(/(no|unknown) (account|user)/);
      expect(lower).not.toMatch(/user not found/);
      expect(result.message).toBe(MESSAGES.invalidCredentials);
    }
  });

  it('returns the identical message for a wrong email and a wrong password (Req 1.6)', async () => {
    const wrongEmail = makeAuthClient({
      signInWithPassword: vi.fn(async () => ({
        data: { session: null },
        error: { message: 'Invalid login credentials', status: 400 },
      })),
    });
    const wrongPassword = makeAuthClient({
      signInWithPassword: vi.fn(async () => ({
        data: { session: null },
        error: { message: 'Invalid login credentials', status: 400 },
      })),
    });

    const emailResult = await signIn(wrongEmail.client, 'unknown@example.com', 'goodpassword');
    const passwordResult = await signIn(wrongPassword.client, 'user@example.com', 'wrongpassword');

    expect(emailResult).toEqual(passwordResult);
  });
});

describe('signOut', () => {
  it('terminates the session on success (Req 1.8)', async () => {
    const { client, signOutFn } = makeAuthClient();

    const result = await signOut(client);

    expect(result).toEqual({ ok: true });
    expect(signOutFn).toHaveBeenCalledOnce();
  });

  it('reports a failure message when sign-out errors', async () => {
    const failing = makeAuthClient({
      signOut: vi.fn(async () => ({ error: { message: 'network error' } })),
    });

    const result = await signOut(failing.client);

    expect(result).toEqual({ ok: false, message: MESSAGES.signOutFailed });
  });
});
