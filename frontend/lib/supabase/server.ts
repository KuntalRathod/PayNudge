import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Server-side Supabase client for use in Server Components, Route Handlers, and
 * Server Actions.
 *
 * Reads and writes the auth session from the Next.js request cookies so the
 * user's session is available on the server. Writing cookies from a Server
 * Component is not always possible (Next.js only allows it in Route Handlers
 * and Server Actions), so the `setAll` implementation swallows the resulting
 * error — session refresh in that case is handled by the middleware instead.
 *
 * The anon key is safe to use here because all data access is guarded by Row
 * Level Security (see design "Row Level Security" section).
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component where cookies cannot be written.
            // The middleware refreshes the session, so this can be ignored.
          }
        },
      },
    },
  );
}
