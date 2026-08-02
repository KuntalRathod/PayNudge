import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';

/**
 * Shared top navigation for authenticated views.
 *
 * Provides the app title, primary section links, and the logout control
 * (Req 1.8). Later UI tasks (15.2–15.5) render this at the top of the
 * dashboard, clients, invoices, and follow-up views for a consistent shell.
 */
const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/clients', label: 'Clients' },
  { href: '/follow-ups', label: 'Follow-ups' },
  { href: '/settings', label: 'Settings' },
];

export function Nav() {
  return (
    <header className="border-b">
      <nav className="container flex h-14 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            PayNudge
          </Link>
          <ul className="hidden items-center gap-4 text-sm text-muted-foreground sm:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-foreground">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <LogoutButton />
      </nav>
    </header>
  );
}
