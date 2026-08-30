import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load .env from the backend package root (not the monorepo root).
//
// We do NOT use `override: true`: on a hosting platform (Render, etc.) the real
// process environment is authoritative — most importantly `PORT`, which the
// platform injects and the app MUST bind to. Overriding it with a local `.env`
// value would make the server listen on the wrong port and receive no traffic.
// A local `.env` still populates any variables the platform hasn't set, which
// is all we need for local development. (There is normally no `.env` file in
// production, so this load is a no-op there.)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import { getConfig } from './config/index.js';
import {
  createSupabaseOverdueDetectionDeps,
  startOverdueDetectionSchedule,
} from './jobs/overdueDetection.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRateLimiter, authRateLimiter } from './middleware/rateLimit.js';
import { createClientsRouter } from './routes/clients.js';
import { createDashboardRouter } from './routes/dashboard.js';
import { createFollowUpsRouter } from './routes/followUps.js';
import { createInvoicesRouter } from './routes/invoices.js';
import { createSettingsRouter } from './routes/settings.js';

/**
 * Creates the Express application. Route handlers for clients, invoices,
 * dashboard, follow-ups, etc. are registered in later tasks.
 */
export function createApp(): Express {
  const app = express();

  // Allow the Next.js frontend (a different origin in dev: localhost:3000 vs
  // localhost:4000) to call this API with credentials (Authorization header).
  // Configurable via FRONTEND_URL for non-default dev ports or deployments.
  app.use(
    cors({
      origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
      credentials: true,
    }),
  );

  // 5mb limit accommodates base64-encoded logo uploads (Settings: Company
  // Logo). Every other endpoint's payloads are tiny by comparison.
  app.use(express.json({ limit: '5mb' }));

  // Trust the platform proxy (Railway/Render/Vercel) so express-rate-limit and
  // req.ip see the real client IP from X-Forwarded-For rather than the proxy's.
  app.set('trust proxy', 1);

  // Liveness probe — registered BEFORE the rate limiter so uptime probes are
  // never throttled, and requires no auth or external services.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Per-IP rate limiting on all API traffic below this point.
  app.use(apiRateLimiter);

  // A STRICTER per-IP limiter on the routes that trigger real external cost —
  // sending an invoice/follow-up email (Resend) or regenerating a draft
  // (Gemini) — to blunt cost-amplification abuse (email/AI-quota exhaustion)
  // beyond the global limiter. Applied at the app level (rather than inside the
  // routers) so the routers stay limiter-free for unit/property tests, which
  // drive these endpoints many times over HTTP. `POST` only, so the read paths
  // that share a prefix are unaffected.
  app.post('/invoices/:id/send', authRateLimiter);
  app.post('/follow-ups/:id/approve', authRateLimiter);
  app.post('/follow-ups/:id/regenerate', authRateLimiter);

  // Feature routers. Each router applies `requireAuth` to its own routes.
  app.use(createClientsRouter());
  app.use(createInvoicesRouter());
  app.use(createDashboardRouter());
  app.use(createFollowUpsRouter());
  app.use(createSettingsRouter());

  // Catch-all 404 for unmatched routes, then the global error handler. Both
  // MUST be registered last: the error handler's 4-arg signature is how Express
  // routes forwarded errors, so any error thrown in a handler lands here as a
  // safe generic response instead of crashing the process or leaking a stack.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Process entry point. Validates configuration up front (fail fast) before
 * starting the HTTP listener.
 */
function main(): void {
  const config = getConfig();
  const app = createApp();

  app.listen(config.PORT, () => {
    console.log(`PayNudge API listening on port ${config.PORT}`);
  });

  // Start the daily overdue detection cron job (Req 7.1).
  // Runs immediately on startup, then once every 24 hours.
  const deps = createSupabaseOverdueDetectionDeps({
    supabaseUrl: config.SUPABASE_URL,
    serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
    googleApiKey: config.GOOGLE_API_KEY,
  });

  startOverdueDetectionSchedule(deps, {
    runImmediately: true,
    onComplete: (summary) => {
      console.log(
        `[overdue-detection] pass complete: evaluated=${summary.evaluated} transitioned=${summary.transitioned} enqueued=${summary.enqueued}`,
      );
    },
    onError: (error) => {
      console.error('[overdue-detection] run failed:', error);
    },
  });
}

// Only start the server when run directly (not when imported by tests).
//
// We compare RESOLVED filesystem paths rather than string-formatting the module
// URL, because `import.meta.url === \`file://${process.argv[1]}\`` is fragile:
// on some hosts (e.g. Render) the URL and argv path differ by symlinks or
// encoding, so the naive comparison is false and `main()` never runs — the
// server silently never starts. Converting both to real paths via
// `fileURLToPath` and `resolve` makes the check robust across environments.
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main();
}
