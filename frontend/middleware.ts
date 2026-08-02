import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Next.js middleware entry point.
 *
 * Runs on every matched request to refresh the Supabase auth session and guard
 * protected routes (`/dashboard`, `/clients`, `/invoices`), redirecting
 * unauthenticated users to `/login` (Req 1.7, 1.8).
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static assets)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - common static image extensions
     * This keeps the session fresh across the app while skipping assets.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
