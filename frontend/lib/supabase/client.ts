import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client for use in Client Components.
 *
 * Reads the public Supabase URL and anon key from the environment. These are
 * `NEXT_PUBLIC_*` variables so they are inlined into the client bundle; the
 * anon key is safe to expose because all data access is guarded by Row Level
 * Security (see design "Row Level Security" section).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
