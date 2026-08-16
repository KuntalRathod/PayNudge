import Link from 'next/link';
import { Check, Zap } from 'lucide-react';
import { SignUpForm } from './signup-form';

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen bg-white">
      {/* Left panel: branding (hidden on mobile) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-indigo-700 p-10 text-white lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        />

        <Link href="/" className="relative flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/15">
            <Zap className="h-4 w-4 text-white" />
          </span>
          PayNudge
        </Link>

        <div className="relative space-y-4">
          <blockquote className="text-2xl font-medium leading-relaxed">
            &ldquo;Create invoices, track payments, and let AI draft follow-ups — with you
            approving every message.&rdquo;
          </blockquote>
          <div className="space-y-2 text-sm text-indigo-200">
            <p className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" /> Professional PDF invoices in seconds
            </p>
            <p className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" /> AI drafts escalating follow-up emails
            </p>
            <p className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" /> Nothing sent without your approval
            </p>
            <p className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" /> Dashboard with real-time analytics
            </p>
          </div>
        </div>

        <p className="relative text-sm text-indigo-300">
          © {new Date().getFullYear()} PayNudge
        </p>
      </div>

      {/* Right panel: form */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <Link href="/" className="mb-8 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide lg:hidden">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600">
            <Zap className="h-4 w-4 text-white" />
          </span>
          PayNudge
        </Link>
        <SignUpForm />
      </main>
    </div>
  );
}
