# Backend Deployment (Render — free tier)

The PayNudge API is a long-running Express process that hosts the daily
overdue-detection cron **in-process**, so it needs a persistent, awake service.

Render's **free web service** is used here. The one catch: free web services
spin down after ~15 minutes of no inbound traffic, which would stop the
in-process cron. We keep the service awake for free with an external uptime
pinger (see step 4). This keeps everything on the **$0 tier** — Render's cron
*job* service type is not free (it has a ~$1/month minimum), so we avoid it.

The `render.yaml` blueprint at the repo root defines the service.

## 1. Create the service (Blueprint)

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, then select this repository.
3. Render reads `render.yaml` and provisions the `paynudge-api` web service:
   - root directory: `backend`
   - build: `npm ci && npm run build`
   - start: `npm run start` (runs `node dist/index.js`)
   - health check: `GET /health`
   - plan: `free`

## 2. Set the secret environment variables

`render.yaml` declares these with `sync: false`, so Render prompts you to enter
them during setup (they are never committed to the repo):

| Variable | Notes |
|----------|-------|
| `GOOGLE_API_KEY` | Google Generative AI key (Gemini) |
| `RESEND_API_KEY` | Resend transactional email key |
| `SUPABASE_URL` | Production Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only; used by the cron) |
| `FRONTEND_URL` | Your deployed frontend origin, e.g. `https://paynudge.vercel.app` — required so CORS allows the frontend (defaults to `http://localhost:3000` otherwise) |

`PORT` is provided by Render automatically; the app reads it and defaults to
`4000` locally.

### Optional (rate limiting) — sensible defaults apply if unset

| Variable | Default | Meaning |
|----------|---------|---------|
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | Rate-limit window |
| `RATE_LIMIT_MAX` | `300` | Max requests per IP per window (all API traffic) |
| `RATE_LIMIT_SENSITIVE_MAX` | `30` | Max requests per IP per window (send/approve/regenerate) |

## 3. Note your service URL

After the first deploy, Render gives the service a URL like
`https://paynudge-api.onrender.com`. Use this as `NEXT_PUBLIC_API_URL` in the
frontend (Vercel) env, and confirm `GET https://paynudge-api.onrender.com/health`
returns `{"status":"ok"}`.

## 4. Keep the service awake (free) so the in-process cron fires

Because a free web service sleeps after 15 minutes idle, set up a free external
pinger to hit `/health` on a short interval. Any free scheduled-HTTP service
works; pick one:

- **cron-job.org** (https://cron-job.org) — free, purpose-built for scheduled
  HTTP requests. Create an account, add a cron job that does a `GET` on
  `https://<your-service>.onrender.com/health`, and set the schedule to every
  5–10 minutes.
- **UptimeRobot** (https://uptimerobot.com) — its free plan allows HTTP(s)
  monitors at a 5-minute interval. Add a monitor for the same `/health` URL.
- **GitHub Actions** (no third-party signup) — a scheduled workflow in this
  repo can `curl` the `/health` URL. Note: GitHub cron granularity is ~5 min
  minimum and scheduled runs can be delayed under load, so a dedicated pinger
  above is more reliable.

Whichever you choose, the goal is the same: hit `/health` at least once every
~10 minutes so the service never idles past the 15-minute spin-down threshold.
This keeps the process warm so the daily overdue-detection cron runs reliably —
at no cost. `/health` is intentionally excluded from rate limiting, so frequent
pings never get throttled.

> If you would rather not run an external pinger at all, the alternative is
> Render's dedicated **Cron Job** service (~$1/month minimum) running the
> overdue-detection logic on a schedule. That is the only non-free piece; the
> pinger approach above keeps everything at $0.

## Notes

- The app calls `app.set('trust proxy', 1)` so rate limiting and `req.ip` see
  the real client IP behind Render's proxy.
- Free tier grants ~750 instance-hours per workspace per month; a single
  always-on service (~730 hrs/month) fits within that allowance.
- The cron runs immediately on startup and every 24h thereafter. It is
  idempotent, so a redeploy or restart mid-run is safe.
