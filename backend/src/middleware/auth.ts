/**
 * Backend authentication middleware — Requirement 1.7.
 *
 * Every API request from the frontend carries the Supabase-issued session JWT
 * as an `Authorization: Bearer <token>` header. This module:
 *
 *   1. Extracts the Bearer token from the header ({@link extractBearerToken}).
 *   2. Verifies the token with Supabase Auth and extracts the `sub` claim as
 *      `user_id` (via `supabase.auth.getUser(token)`).
 *   3. Builds a REQUEST-SCOPED Supabase client whose every request runs with
 *      the user's JWT in the `Authorization` header, so all database access
 *      executes under that user's Row Level Security context
 *      ({@link buildRequestScopedClient}).
 *   4. Attaches `req.userId` and `req.supabase` for downstream handlers.
 *
 * Requests without a valid token are rejected with `401` and a generic body
 * that does not leak why verification failed.
 *
 * The verification logic and the scoped-client construction are factored into
 * small, injectable units so they can be unit-tested without a live Supabase
 * instance (see {@link createRequireAuth}'s `createClient` dependency).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { getConfig } from '../config/index.js';

// Augment Express's Request so handlers behind `requireAuth` can read the
// authenticated user id and the RLS-scoped Supabase client in a typed way.
declare module 'express-serve-static-core' {
  interface Request {
    /** The authenticated user's id (the JWT `sub` claim). */
    userId: string;
    /** A Supabase client scoped to the authenticated user's RLS context. */
    supabase: SupabaseClient;
  }
}

/** The subset of `createClient` this module depends on (for injection/testing). */
export type CreateSupabaseClient = typeof createClient;

/** Supabase connection settings needed to verify tokens and scope clients. */
export interface AuthConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/** Dependencies for {@link createRequireAuth}. */
export interface RequireAuthDeps {
  config: AuthConfig;
  /** Overridable Supabase client factory; defaults to `@supabase/supabase-js`. */
  createClient?: CreateSupabaseClient;
}

/**
 * Extracts a Bearer token from an `Authorization` header value.
 *
 * Returns the raw token when the header is a well-formed `Bearer <token>`
 * (scheme is case-insensitive, token is non-empty), otherwise `null`.
 */
export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (typeof authorizationHeader !== 'string') {
    return null;
  }

  const trimmed = authorizationHeader.trim();
  const match = /^Bearer[ \t]+(.+)$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  const token = match[1]!.trim();
  return token.length > 0 ? token : null;
}

/**
 * Builds a request-scoped Supabase client that sends the user's JWT as the
 * `Authorization` header on every request, so all database access runs under
 * that user's RLS context (`auth.uid()` resolves to the token's `sub`).
 *
 * Session persistence and auto-refresh are disabled: the client is created per
 * request and discarded, and the caller supplies the token explicitly.
 */
export function buildRequestScopedClient(
  token: string,
  config: AuthConfig,
  createClientFn: CreateSupabaseClient = createClient,
): SupabaseClient {
  return createClientFn(config.supabaseUrl, config.supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

/** Sends a generic 401 that does not disclose why verification failed. */
function sendUnauthorized(res: Response): void {
  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Creates the `requireAuth` middleware from explicit dependencies.
 *
 * The returned middleware verifies the Bearer token, and on success attaches
 * `req.userId` and a request-scoped `req.supabase` client before calling
 * `next()`. On any failure it responds `401` and does not call `next()`.
 */
export function createRequireAuth(deps: RequireAuthDeps): RequestHandler {
  const createClientFn = deps.createClient ?? createClient;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req.headers.authorization);
    if (token === null) {
      sendUnauthorized(res);
      return;
    }

    // A scoped client verifies the token and, if valid, is reused for DB access
    // so every query runs under the user's RLS context.
    const scopedClient = buildRequestScopedClient(token, deps.config, createClientFn);

    try {
      const { data, error } = await scopedClient.auth.getUser(token);
      if (error || !data?.user?.id) {
        sendUnauthorized(res);
        return;
      }

      req.userId = data.user.id;
      req.supabase = scopedClient;
      next();
    } catch {
      // Never leak verification internals to the caller.
      sendUnauthorized(res);
    }
  };
}

let cachedMiddleware: RequestHandler | undefined;

/**
 * Default `requireAuth` middleware wired to the process configuration.
 *
 * Configuration is read lazily on first use (and memoized) so importing this
 * module does not require a fully-populated environment at import time — which
 * keeps unit tests that exercise {@link createRequireAuth} directly hermetic.
 */
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!cachedMiddleware) {
    const config = getConfig();
    cachedMiddleware = createRequireAuth({
      config: {
        supabaseUrl: config.SUPABASE_URL,
        supabaseAnonKey: config.SUPABASE_ANON_KEY,
      },
    });
  }
  return cachedMiddleware(req, res, next);
};
