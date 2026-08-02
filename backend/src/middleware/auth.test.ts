import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import {
  buildRequestScopedClient,
  createRequireAuth,
  extractBearerToken,
  type AuthConfig,
} from './auth.js';

/**
 * Unit tests for the backend JWT verification middleware (Requirement 1.7).
 *
 * The middleware is exercised through its injectable factory
 * ({@link createRequireAuth}) with a fake Supabase client factory, so no live
 * Supabase instance is required.
 */

const config: AuthConfig = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'test-anon-key',
};

/** Builds a minimal mocked Express request/response/next triple. */
function buildHttpMocks(authorization?: string): {
  req: Request;
  res: Response;
  next: NextFunction;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = { headers: { authorization } } as unknown as Request;
  const res = { status } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next, status, json };
}

describe('extractBearerToken', () => {
  it('returns the token from a well-formed Bearer header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the scheme and tolerates extra whitespace', () => {
    expect(extractBearerToken('  bearer   token123  ')).toBe('token123');
  });

  it('returns null when the header is missing', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null when the scheme is not Bearer', () => {
    expect(extractBearerToken('Basic abc123')).toBeNull();
  });

  it('returns null when the token is empty', () => {
    expect(extractBearerToken('Bearer   ')).toBeNull();
  });
});

describe('buildRequestScopedClient', () => {
  it('creates a client that sends the user JWT as the Authorization header', () => {
    const createClientFn = vi.fn().mockReturnValue({});

    buildRequestScopedClient('user-jwt', config, createClientFn as never);

    expect(createClientFn).toHaveBeenCalledTimes(1);
    const [url, key, options] = createClientFn.mock.calls[0]!;
    expect(url).toBe(config.supabaseUrl);
    expect(key).toBe(config.supabaseAnonKey);
    expect(options.global.headers.Authorization).toBe('Bearer user-jwt');
    expect(options.auth.persistSession).toBe(false);
    expect(options.auth.autoRefreshToken).toBe(false);
  });
});

describe('createRequireAuth', () => {
  it('attaches userId and scoped client, then calls next on a valid token', async () => {
    const scopedClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }) },
    };
    const createClientFn = vi.fn().mockReturnValue(scopedClient);
    const middleware = createRequireAuth({ config, createClient: createClientFn as never });

    const { req, res, next, status } = buildHttpMocks('Bearer valid.token');
    await middleware(req, res, next);

    expect(scopedClient.auth.getUser).toHaveBeenCalledWith('valid.token');
    expect(req.userId).toBe('user-123');
    expect(req.supabase).toBe(scopedClient);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('rejects with 401 when no Authorization header is present', async () => {
    const createClientFn = vi.fn();
    const middleware = createRequireAuth({ config, createClient: createClientFn as never });

    const { req, res, next, status, json } = buildHttpMocks(undefined);
    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
    // No verification is attempted without a token.
    expect(createClientFn).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the token fails verification', async () => {
    const scopedClient = {
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: { message: 'bad token' } }),
      },
    };
    const createClientFn = vi.fn().mockReturnValue(scopedClient);
    const middleware = createRequireAuth({ config, createClient: createClientFn as never });

    const { req, res, next, status, json } = buildHttpMocks('Bearer invalid.token');
    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
    expect(req.userId).toBeUndefined();
  });

  it('rejects with 401 and does not leak internals when verification throws', async () => {
    const scopedClient = {
      auth: { getUser: vi.fn().mockRejectedValue(new Error('network down')) },
    };
    const createClientFn = vi.fn().mockReturnValue(scopedClient);
    const middleware = createRequireAuth({ config, createClient: createClientFn as never });

    const { req, res, next, status, json } = buildHttpMocks('Bearer some.token');
    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });
});
