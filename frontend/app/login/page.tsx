import { Suspense } from 'react';
import { LoginForm } from './login-form';

/**
 * Login view (Req 1.5–1.7).
 *
 * The form is a client component that reads the `redirectTo` search param, so
 * it is wrapped in a Suspense boundary as required by the Next.js App Router.
 */
export default function LoginPage() {
  return (
    <main className="container flex min-h-screen items-center justify-center py-12">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
