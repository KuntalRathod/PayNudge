import { Button } from '@/components/ui/button';

/**
 * Logout control (Req 1.8).
 *
 * Renders a form that POSTs to the `/auth/logout` route handler, which
 * terminates the Supabase session and redirects to `/login`. Using a form POST
 * (rather than a client-side call) avoids accidental logout via link
 * prefetching and works without JavaScript. Reused by the shared nav and any
 * later authenticated view.
 */
export function LogoutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/logout" method="post" className={className}>
      <Button type="submit" variant="outline" size="sm">
        Log out
      </Button>
    </form>
  );
}
