/**
 * Auth helper actions (Requirement 1).
 *
 * Thin, framework-free wrappers around the Supabase Auth client that encode the
 * requirement-specific behavior for sign-up, login, and logout so the UI (and
 * tests) get a single, predictable result shape:
 *
 *   - Sign-up validates email format (Req 1.2) and password length 8–128
 *     (Req 1.3) BEFORE calling Supabase, then maps a duplicate-email response to
 *     a stable message (Req 1.4); on success a session is established (Req 1.1).
 *   - Login maps any credential failure to a single NON-DISCLOSING message that
 *     never reveals which field was wrong (Req 1.6); on success a session is
 *     established (Req 1.5).
 *   - Logout terminates the session (Req 1.8).
 *
 * Each function takes the Supabase client as an argument rather than importing a
 * concrete one, which keeps the logic testable with a mocked auth client and
 * lets callers pass the browser or server client as appropriate.
 */

/** Minimal shape of the Supabase auth surface these helpers depend on. */
export interface AuthClientLike {
  auth: {
    signUp(credentials: {
      email: string;
      password: string;
    }): Promise<{ data: SignUpData; error: AuthErrorLike | null }>;
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<{ data: unknown; error: AuthErrorLike | null }>;
    signOut(): Promise<{ error: AuthErrorLike | null }>;
  };
}

/** The subset of Supabase's `AuthError` these helpers inspect. */
export interface AuthErrorLike {
  message: string;
  status?: number;
  code?: string;
}

/** The subset of Supabase's sign-up `data` these helpers inspect. */
export interface SignUpData {
  user?: {
    id?: string;
    /**
     * Supabase returns an empty `identities` array for an already-registered
     * email when email confirmation is enabled (to avoid user enumeration).
     */
    identities?: unknown[] | null;
  } | null;
  session?: unknown;
}

/** Discriminated result returned by every auth helper. */
export type AuthResult = { ok: true } | { ok: false; message: string };

/** Inclusive password length bounds (Req 1.3). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Stable, user-facing messages. */
export const MESSAGES = {
  invalidEmail: 'Please enter a valid email address.',
  passwordLength: `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
  emailAlreadyRegistered: 'This email address is already registered.',
  /**
   * Deliberately non-disclosing: identical whether the email is unknown or the
   * password is wrong, so the failure never reveals which field was incorrect
   * (Req 1.6).
   */
  invalidCredentials: 'Invalid email or password.',
  signUpFailed: 'Unable to create your account. Please try again.',
  signOutFailed: 'Unable to log out. Please try again.',
} as const;

/**
 * Standard email format — mirrors the backend client-validation regex so the
 * two layers agree on what a "valid email format" is (Req 1.2, 2.5).
 */
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** Returns true when `email` conforms to the standard email format. */
export function isValidEmailFormat(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

/** Returns true when `password` length is within the inclusive 8–128 bound. */
export function isValidPasswordLength(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

/**
 * Heuristic for Supabase's "already registered" signal, which can arrive either
 * as an explicit error or as a success payload whose user has no identities.
 */
function isDuplicateEmail(data: SignUpData, error: AuthErrorLike | null): boolean {
  if (error) {
    const msg = error.message?.toLowerCase() ?? '';
    if (
      error.code === 'user_already_exists' ||
      error.status === 422 ||
      msg.includes('already registered') ||
      msg.includes('already exists') ||
      msg.includes('already been registered')
    ) {
      return true;
    }
  }
  // Email-confirmation-enabled projects return a user with an empty identities
  // array for an existing email instead of an error.
  const identities = data?.user?.identities;
  if (Array.isArray(identities) && identities.length === 0) {
    return true;
  }
  return false;
}

/**
 * Signs a visitor up (Req 1.1–1.4).
 *
 * Validates email format and password length locally first, then delegates to
 * Supabase Auth. A duplicate email is reported with a stable message and leaves
 * the existing account untouched (the create call is a no-op server-side).
 */
export async function signUp(
  client: AuthClientLike,
  email: string,
  password: string,
): Promise<AuthResult> {
  if (!isValidEmailFormat(email)) {
    return { ok: false, message: MESSAGES.invalidEmail };
  }
  if (!isValidPasswordLength(password)) {
    return { ok: false, message: MESSAGES.passwordLength };
  }

  const { data, error } = await client.auth.signUp({ email: email.trim(), password });

  if (isDuplicateEmail(data, error)) {
    return { ok: false, message: MESSAGES.emailAlreadyRegistered };
  }
  if (error) {
    return { ok: false, message: error.message || MESSAGES.signUpFailed };
  }
  return { ok: true };
}

/**
 * Logs a user in (Req 1.5, 1.6).
 *
 * Any credential failure is collapsed to a single non-disclosing message so the
 * response never reveals whether the email or the password was wrong.
 */
export async function signIn(
  client: AuthClientLike,
  email: string,
  password: string,
): Promise<AuthResult> {
  const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    return { ok: false, message: MESSAGES.invalidCredentials };
  }
  return { ok: true };
}

/**
 * Logs the current user out, terminating the session (Req 1.8).
 */
export async function signOut(client: AuthClientLike): Promise<AuthResult> {
  const { error } = await client.auth.signOut();
  if (error) {
    return { ok: false, message: MESSAGES.signOutFailed };
  }
  return { ok: true };
}
