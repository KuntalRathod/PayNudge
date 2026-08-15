import Link from 'next/link';
import { ArrowRight, Check, Zap } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PLANS } from './plans';

const COMPARISON: Array<{ feature: string; free: string; pro: string; business: string }> = [
  { feature: 'Clients', free: '3', pro: 'Unlimited', business: 'Unlimited' },
  { feature: 'Invoices per month', free: '5', pro: '50', business: 'Unlimited' },
  { feature: 'AI follow-ups per month', free: '—', pro: '10', business: 'Unlimited' },
  { feature: 'Branded PDF invoices', free: '✓', pro: '✓', business: '✓' },
  { feature: 'Your logo on invoices', free: '—', pro: '✓', business: '✓' },
  { feature: 'Calendar view', free: '—', pro: '✓', business: '✓' },
  { feature: 'CSV import / export', free: '—', pro: '✓', business: '✓' },
  { feature: 'Custom follow-up schedule', free: '—', pro: '—', business: '✓' },
  { feature: 'Remove PayNudge branding', free: '—', pro: '—', business: '✓' },
  { feature: 'Priority email delivery', free: '—', pro: '—', business: '✓' },
];

const FAQS = [
  {
    q: 'Is the Free plan really free?',
    a: 'Yes, forever. No credit card, no trial timer. You get 3 clients and 5 invoices a month for as long as you want.',
  },
  {
    q: 'What happens when I hit a plan limit?',
    a: 'You will see a prompt to upgrade. Nothing is deleted or locked — your existing invoices and clients stay exactly as they are.',
  },
  {
    q: 'Can I switch plans later?',
    a: 'Anytime. Upgrades apply instantly and billing is prorated. Downgrades take effect at the end of your current cycle.',
  },
  {
    q: 'Do you offer refunds?',
    a: 'Yes. Full refund within 14 days of any paid plan purchase, no questions asked.',
  },
  {
    q: 'Do paid plans have a free trial?',
    a: 'Both Pro and Business include a 14-day free trial. No credit card required to start.',
  },
  {
    q: 'Will you email my clients automatically?',
    a: 'Never without your approval. AI drafts the follow-up, but you read it and click send. You are always in control.',
  },
];

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b bg-background/90 backdrop-blur-xl">
        <nav className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground">
              <Zap className="h-4 w-4 text-background" />
            </span>
            PayNudge
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Log in
            </Link>
            <Link href="/signup" className={buttonVariants({ size: 'sm' })}>
              Start free
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* Header */}
        <section className="border-b bg-muted/30 py-20">
          <div className="container flex flex-col items-center gap-4 text-center">
            <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
              Costs less than one late invoice
            </h1>
            <p className="max-w-lg text-lg text-muted-foreground">
              Start free. Upgrade when you need unlimited clients and AI-written follow-ups.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pt-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-emerald-500" /> 14-day free trial
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-emerald-500" /> No credit card to start
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-emerald-500" /> Cancel anytime
              </span>
            </div>
          </div>
        </section>

        {/* Plans */}
        <section className="border-b py-20">
          <div className="container">
            <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
              {PLANS.map((plan) => (
                <div
                  key={plan.name}
                  className={cn(
                    'relative flex flex-col rounded-xl border p-6',
                    plan.highlighted
                      ? 'border-foreground bg-card shadow-lg'
                      : 'border-border bg-card',
                  )}
                >
                  {plan.highlighted ? (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background">
                      Most popular
                    </span>
                  ) : null}

                  <h3 className="font-semibold">{plan.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>

                  <div className="mt-5 flex items-baseline gap-1">
                    <span className="text-4xl font-bold tracking-tight">{plan.price}</span>
                    <span className="text-sm text-muted-foreground">{plan.period}</span>
                  </div>
                  <p className="mt-1 min-h-5 text-xs text-muted-foreground">
                    {plan.yearlyNote ?? ''}
                  </p>

                  <Link
                    href="/signup"
                    className={cn(
                      buttonVariants({ variant: plan.highlighted ? 'default' : 'outline' }),
                      'mt-6 w-full',
                    )}
                  >
                    {plan.cta}
                  </Link>

                  <ul className="mt-7 flex-1 space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-sm">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Comparison table */}
        <section className="border-b bg-muted/30 py-20">
          <div className="container">
            <h2 className="mb-10 text-center text-3xl font-bold tracking-tight">
              Compare plans
            </h2>

            <div className="mx-auto max-w-4xl overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th scope="col" className="px-5 py-3.5 text-left font-semibold">
                      Feature
                    </th>
                    <th scope="col" className="px-5 py-3.5 text-center font-semibold">
                      Free
                    </th>
                    <th scope="col" className="px-5 py-3.5 text-center font-semibold">
                      Pro
                    </th>
                    <th scope="col" className="px-5 py-3.5 text-center font-semibold">
                      Business
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row) => (
                    <tr key={row.feature} className="border-b last:border-0">
                      <td className="px-5 py-3.5 text-muted-foreground">{row.feature}</td>
                      <td className="px-5 py-3.5 text-center font-medium">{row.free}</td>
                      <td className="px-5 py-3.5 text-center font-medium">{row.pro}</td>
                      <td className="px-5 py-3.5 text-center font-medium">{row.business}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-b py-20">
          <div className="container">
            <h2 className="mb-12 text-center text-3xl font-bold tracking-tight">
              Frequently asked questions
            </h2>
            <div className="mx-auto grid max-w-4xl gap-x-10 gap-y-8 sm:grid-cols-2">
              {FAQS.map((faq) => (
                <div key={faq.q}>
                  <h3 className="mb-2 font-semibold">{faq.q}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24">
          <div className="container flex flex-col items-center gap-6 text-center">
            <h2 className="max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">
              Start free today
            </h2>
            <p className="max-w-md text-muted-foreground">
              No credit card. Send your first invoice in the next two minutes.
            </p>
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: 'lg' }), 'px-8 text-base')}
            >
              Create free account
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-10">
        <div className="container flex flex-col items-center justify-between gap-5 sm:flex-row">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground">
              <Zap className="h-3.5 w-3.5 text-background" />
            </span>
            PayNudge
          </div>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} PayNudge. All rights reserved.
          </p>
          <div className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link href="/" className="transition-colors hover:text-foreground">
              Home
            </Link>
            <Link href="/login" className="transition-colors hover:text-foreground">
              Log in
            </Link>
            <Link href="/signup" className="transition-colors hover:text-foreground">
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
