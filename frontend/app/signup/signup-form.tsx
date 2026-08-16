'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, signUp } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CornerBrackets } from '@/components/landing/corner-brackets';

/**
 * Sign-up form (Req 1.1–1.4).
 *
 * Delegates to the `signUp` helper, which validates email format (Req 1.2) and
 * password length 8–128 (Req 1.3) locally before calling Supabase Auth, and
 * maps a duplicate email to a stable message (Req 1.4). On success a session is
 * established (Req 1.1) and the user is sent to the dashboard.
 *
 * Note: when a Supabase project has email confirmation enabled, sign-up does
 * not immediately establish a session. We handle both cases: if a session is
 * present we go to the dashboard; otherwise we surface a check-your-email
 * notice and route to login.
 */
export function SignUpForm() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);

    const supabase = createClient();
    const result = await signUp(supabase, email, password);

    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
      return;
    }

    // On success, establish the session view. If email confirmation is enabled
    // the session may not exist yet; guide the user to log in once confirmed.
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      router.replace('/dashboard');
      router.refresh();
      return;
    }

    setNotice('Account created. Check your email to confirm, then log in.');
    setSubmitting(false);
  }

  return (
    <div className="relative w-full max-w-sm border border-slate-200 bg-white p-7">
      <CornerBrackets className="text-slate-300" />

      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500">Start creating and chasing invoices in minutes.</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
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
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
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
          <p className="text-xs text-slate-500">
            Must be {PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} characters.
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-slate-500">
            {notice}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={submitting}
          className="relative w-full bg-indigo-600 text-xs font-bold uppercase tracking-widest text-white hover:bg-indigo-700"
        >
          <CornerBrackets className="text-indigo-300" />
          {submitting ? 'Creating account…' : 'Sign up'}
        </Button>

        <p className="text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-indigo-600 underline-offset-4 hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </div>
  );
}
