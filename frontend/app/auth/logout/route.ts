import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Logout route handler.
 *
 * Terminates the current Supabase session and redirects to `/login`. After the
 * session is cleared, the middleware guard redirects any subsequent request to
 * a protected view (`/dashboard`, `/clients`, `/invoices`) to `/login`
 * (Req 1.8).
 *
 * Exposed as POST to avoid accidental logout via link prefetching or GET
 * navigation.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(new URL('/login', request.url), {
    status: 303,
  });
}
