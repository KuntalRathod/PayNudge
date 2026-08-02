import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function Home() {
  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">PayNudge</h1>
        <p className="max-w-md text-muted-foreground">
          Create invoices, track payments, and let AI draft follow-ups for overdue invoices — with
          you approving every message.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Link href="/signup" className={buttonVariants()}>
          Get started
        </Link>
        <Link href="/login" className={buttonVariants({ variant: 'outline' })}>
          Log in
        </Link>
      </div>
    </main>
  );
}
