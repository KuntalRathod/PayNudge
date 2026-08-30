# TODO: Add Google Sign-In (post-launch)

Google OAuth is a purely additive feature — it does not touch the existing
email/password auth, needs no database migration, and works with the current
RLS policies (an OAuth user is just another row in `auth.users`, so
`user_id = auth.uid()` is unchanged). Add it after going live, once the
production domains are known.

Estimated effort: ~30–40 min (mostly dashboard config, small amount of code).

## Part A — Dashboard config (no code)

1. **Google Cloud Console** (https://console.cloud.google.com):
   - Create a project (or reuse one).
   - APIs & Services → Credentials → Create Credentials → **OAuth client ID**.
   - Application type: **Web application**.
   - Authorized redirect URI: your Supabase callback, which looks like
     `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (find the exact value in the Supabase step below).
   - Copy the generated **Client ID** and **Client Secret**.

2. **Supabase dashboard** → Authentication → Providers → **Google**:
   - Enable it, paste the Client ID + Client Secret, save.
   - This page also shows the exact callback URL to paste back into Google
     Cloud (step 1) if you did not have it yet.

3. **Supabase** → Authentication → URL Configuration:
   - Confirm the **Site URL** and **Redirect URLs** include the production
     frontend domain (e.g. `https://paynudge.vercel.app`) so the post-login
     redirect resolves correctly.

## Part B — Code (3 small changes)

1. **Add an OAuth sign-in helper** in `frontend/lib/auth/actions.ts`:
   - A `signInWithGoogle(client)` that calls
     `client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/auth/callback } })`.
   - Note: the existing helpers take an `AuthClientLike` interface; either extend
     that interface with `signInWithOAuth` or accept the concrete browser client
     here since OAuth is browser-only.

2. **Add the OAuth callback route** `frontend/app/auth/callback/route.ts`:
   - A Next.js Route Handler that reads the `?code=` query param, calls
     `supabase.auth.exchangeCodeForSession(code)` using the server client
     (`frontend/lib/supabase/server.ts`), then redirects to `/dashboard`.
   - This route does NOT exist yet (only `/auth/logout` does) and is REQUIRED —
     without it the Google redirect has nowhere to complete the session.

3. **Add a "Continue with Google" button** to both:
   - `frontend/app/login/login-form.tsx`
   - `frontend/app/signup/signup-form.tsx`
   - Wire each to the new `signInWithGoogle` helper. Place it above or below the
     email/password form with a subtle "or" divider.

## Gotchas

- The #1 failure is **`redirect_uri_mismatch`** — the redirect URI in Google
  Cloud must EXACTLY match Supabase's callback URL (scheme, host, path, no
  trailing slash differences).
- `NEXT_PUBLIC_*` env changes require a redeploy on Vercel to take effect.
- Test the full round-trip in production (or a preview deploy), not just
  localhost, since the redirect URLs differ.
