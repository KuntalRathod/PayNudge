import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Route prefixes that require an authenticated session. An unauthenticated
 * request to any of these is redirected to `/login` (Req 1.7, 1.8).
 */
export const PROTECTED_PREFIXES = ['/dashboard', '/clients', '/invoices'] as const;

/**
 * Returns true when the given pathname falls under a protected route prefix.
 * A prefix matches either the prefix itself (`/clients`) or any sub-path
 * (`/clients/123`), but not an unrelated route that merely starts with the
 * same characters (`/clientside`).
 */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Refreshes the Supabase auth session on every request and enforces the route
 * guard for protected views.
 *
 * The token-refresh dance follows the official Supabase SSR pattern: cookies
 * read from the incoming request are mirrored onto both the request and the
 * outgoing response so a refreshed session is persisted for the browser and
 * visible to downstream Server Components on the same request.
 *
 * When no authenticated user is present and the request targets a protected
 * route, the user is redirected to `/login` (Req 1.7). Because logging out
 * clears the session cookies, any subsequent request to a protected route is
 * likewise redirected (Req 1.8).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() revalidates the token with the auth server; do not use
  // getSession() here, which trusts unverified cookie data.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('redirectTo', request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
