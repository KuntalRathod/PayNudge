/**
 * Global error-handling middleware for the PayNudge API.
 *
 * Express identifies error middleware by its four-argument signature
 * `(err, req, res, next)`. This MUST be registered LAST, after all routes, so
 * that any error thrown or forwarded via `next(err)` from a handler is caught
 * here instead of crashing the process or leaking a stack trace to the client.
 *
 * Behavior:
 *   - Logs the full error server-side for observability.
 *   - Returns a generic `500` JSON body — never the error message or stack — so
 *     internal details are never disclosed to callers.
 *   - Respects `err.status`/`err.statusCode` when a handler deliberately attaches
 *     one (e.g. a 400/404 forwarded via `next`), otherwise defaults to 500.
 *   - Delegates to Express's default handler if the response has already begun
 *     streaming (headers sent), per Express guidance.
 */

import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

/** Extracts an HTTP status from an unknown error shape, defaulting to 500. */
function statusFromError(err: unknown): number {
  if (typeof err === 'object' && err !== null) {
    const candidate =
      (err as { status?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
    if (typeof candidate === 'number' && candidate >= 400 && candidate <= 599) {
      return candidate;
    }
  }
  return 500;
}

/**
 * The Express global error handler. Register with `app.use(errorHandler)` AFTER
 * all routes.
 */
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // If headers are already sent, hand off to Express's default handler, which
  // will close the connection.
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = statusFromError(err);

  // Log the real error server-side for debugging; never send it to the client.
  console.error('[error]', err);

  res.status(status).json({
    error:
      status >= 500
        ? 'An unexpected error occurred.'
        : 'The request could not be completed.',
  });
};

/**
 * Catch-all 404 for unmatched routes. Register AFTER all routes but BEFORE
 * {@link errorHandler}. Keeps unknown paths from falling through to Express's
 * bare HTML "Cannot GET" response.
 */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found.' });
}
