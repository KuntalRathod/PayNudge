# Backend Deployment (Railway)

The PayNudge API is a long-running Express process (it hosts the daily
overdue-detection cron in-process), so it needs a persistent host — not a
serverless function. Railway is the recommended target; `railway.json` in this
directory configures the build, start command, and health check.

## One-time setup

1. Create a new Railway project and connect this repository.
2. Set the service **root directory** to `backend` (so Railway builds this
   package, not the monorepo root).
3. Railway reads `railway.json` automatically:
   - build: `npm ci && npm run build`
   - start: `npm run start` (runs `node dist/index.js`)
   - health check: `GET /health`

## Required environment variables

Set these in the Railway service's Variables tab:

| Variable | Notes |
|----------|-------|
| `GOOGLE_API_KEY` | Google Generative AI key (Gemini) |
| `RESEND_API_KEY` | Resend transactional email key |
| `SUPABASE_URL` | Production Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only; used by the cron) |
| `FRONTEND_URL` | Your deployed frontend origin, e.g. `https://paynudge.vercel.app` — required so CORS allows the frontend (defaults to `http://localhost:3000` otherwise) |

`PORT` is provided by Railway automatically; the app reads it and defaults to
`4000` locally.

## Optional environment variables (rate limiting)

Sensible defaults apply if unset:

| Variable | Default | Meaning |
|----------|---------|---------|
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | Rate-limit window |
| `RATE_LIMIT_MAX` | `300` | Max requests per IP per window (all API traffic) |
| `RATE_LIMIT_SENSITIVE_MAX` | `30` | Max requests per IP per window (sensitive routes) |

## Notes

- The app calls `app.set('trust proxy', 1)` so rate limiting and `req.ip` see
  the real client IP behind Railway's proxy.
- The cron runs immediately on startup and every 24h thereafter. It is
  idempotent, so a redeploy mid-run is safe. Keep the service always-on (avoid
  hosts that sleep idle instances, or the cron may not fire reliably).
