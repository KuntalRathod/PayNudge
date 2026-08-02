'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, signUp } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

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
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Start creating and chasing invoices in minutes.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
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
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Must be {PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} characters.
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3">
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Creating account…' : 'Sign up'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-primary underline-offset-4 hover:underline">
              Log in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
