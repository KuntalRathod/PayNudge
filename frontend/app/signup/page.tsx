import Link from 'next/link';
import { SignUpForm } from './signup-form';

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen">
      {/* Left panel: branding (hidden on mobile) */}
      <div className="hidden w-1/2 flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <Link href="/" className="text-lg font-semibold">
          PayNudge
        </Link>
        <div className="space-y-4">
          <blockquote className="text-2xl font-medium leading-relaxed">
            &ldquo;Create invoices, track payments, and let AI draft follow-ups — with you
            approving every message.&rdquo;
          </blockquote>
          <div className="space-y-2 text-sm text-primary-foreground/70">
            <p>✓ Professional PDF invoices in seconds</p>
            <p>✓ AI drafts escalating follow-up emails</p>
            <p>✓ Nothing sent without your approval</p>
            <p>✓ Dashboard with real-time analytics</p>
          </div>
        </div>
        <p className="text-sm text-primary-foreground/60">
          © {new Date().getFullYear()} PayNudge
        </p>
      </div>

      {/* Right panel: form */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <Link href="/" className="mb-8 text-lg font-semibold lg:hidden">
          PayNudge
        </Link>
        <SignUpForm />
      </main>
    </div>
  );
}
