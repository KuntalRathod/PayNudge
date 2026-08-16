import { Suspense } from 'react';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import { LoginForm } from './login-form';

export default function LoginPage() {
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
            &ldquo;Stop chasing payments manually. Let AI handle the awkward follow-ups while you
            focus on your work.&rdquo;
          </blockquote>
          <p className="text-indigo-200">
            AI-powered invoice follow-ups for freelancers and small businesses.
          </p>
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
        <Suspense>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
