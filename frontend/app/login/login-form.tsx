'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { signIn } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CornerBrackets } from '@/components/landing/corner-brackets';
import { cn } from '@/lib/utils';

/**
 * Login form (Req 1.5, 1.6, 1.7).
 *
 * Submits credentials to Supabase Auth via the `signIn` helper, which collapses
 * any credential failure into a single NON-DISCLOSING message (Req 1.6). On
 * success a session cookie is established and the user is redirected to the
 * originally requested protected route (via `redirectTo`, populated by the
 * middleware guard) or `/dashboard` by default (Req 1.7). `router.refresh()`
 * re-runs the server components/middleware so the new session is picked up.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const supabase = createClient();
    const result = await signIn(supabase, email, password);

    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
      return;
    }

    router.replace(redirectTo);
    router.refresh();
  }

  return (
    <div className="relative w-full max-w-sm border border-slate-200 bg-white p-7">
      <CornerBrackets className="text-slate-300" />

      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Log in</h1>
        <p className="mt-1 text-sm text-slate-500">Welcome back. Enter your credentials to continue.</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-slate-900">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            className="border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-indigo-600"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className="text-slate-900">Password</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className="border-slate-300 bg-white pr-10 text-slate-900 placeholder:text-slate-400 focus-visible:ring-indigo-600"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={submitting}
          className={cn('relative w-full bg-indigo-600 text-xs font-bold uppercase tracking-widest text-white hover:bg-indigo-700')}
        >
          <CornerBrackets className="text-indigo-300" />
          {submitting ? 'Logging in…' : 'Log in'}
        </Button>

        <p className="text-center text-sm text-slate-500">
          Need an account?{' '}
          <Link href="/signup" className="font-medium text-indigo-600 underline-offset-4 hover:underline">
            Sign up
          </Link>
        </p>
      </form>
    </div>
  );
}
