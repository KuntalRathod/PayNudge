import { Suspense } from 'react';
import Link from 'next/link';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* Left panel: branding (hidden on mobile) */}
      <div className="hidden w-1/2 flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <Link href="/" className="text-lg font-semibold">
          PayNudge
        </Link>
        <div className="space-y-4">
          <blockquote className="text-2xl font-medium leading-relaxed">
            &ldquo;Stop chasing payments manually. Let AI handle the awkward follow-ups while you
            focus on your work.&rdquo;
          </blockquote>
          <p className="text-primary-foreground/70">
            AI-powered invoice follow-ups for freelancers and small businesses.
          </p>
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
        <Suspense>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
