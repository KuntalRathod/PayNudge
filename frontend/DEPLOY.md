# Frontend Deployment (Vercel — free tier)

The PayNudge frontend is a Next.js 14 (App Router) app. Vercel is the natural
host — zero-config for Next.js and free for personal/hobby use.

Deploy the backend first (see `backend/DEPLOY.md`) so you have its public URL
ready to plug in as `NEXT_PUBLIC_API_URL`.

## 1. Import the project

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project**, then import this repository.
3. Set the **Root Directory** to `frontend` (this is a monorepo; Vercel must
   build the frontend package, not the repo root).
4. Framework preset is auto-detected as **Next.js**. Leave the default build
   (`next build`) and output settings as-is.

## 2. Set the environment variables

Add these in the Vercel project's **Settings → Environment Variables**
(Production, and Preview if you use preview deploys):

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your production Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key (safe to expose; all access is guarded by RLS) |
| `NEXT_PUBLIC_API_URL` | Your deployed backend URL, e.g. `https://paynudge-api.onrender.com` |

`NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so
after changing any of them you must **redeploy** for the change to take effect.

## 3. Wire the two sides together

Deployment is a two-way handshake between Vercel and the backend/Supabase:

1. **Backend CORS** — set `FRONTEND_URL` on the backend (Render) to your Vercel
   domain, e.g. `https://paynudge.vercel.app`. Without this, the browser blocks
   API calls with a CORS error.
2. **Supabase Auth URLs** — in the Supabase dashboard under **Authentication →
   URL Configuration**, set the **Site URL** to your Vercel domain and add it to
   **Redirect URLs**. Otherwise login/signup email-confirmation links point at
   `localhost` and break in production.

## 4. Verify

- Open the Vercel URL; the landing page should load.
- Sign up / log in, then confirm the dashboard fetches data (this proves
  `NEXT_PUBLIC_API_URL` + backend CORS are correct).
- If API calls fail, check: backend `FRONTEND_URL` matches the Vercel origin
  exactly (scheme + host, no trailing slash), and `NEXT_PUBLIC_API_URL` points
  at the live backend with no trailing slash.

## Notes

- Free-tier backends on Render sleep when idle; the **first** API call after a
  sleep may take ~1 minute while the service wakes. The UptimeRobot pinger in
  `backend/DEPLOY.md` prevents this by keeping the backend warm.
- Use a production Supabase project (separate from local dev), and apply the
  migrations in `backend/supabase/migrations/` to it before going live.
