import Link from 'next/link';
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  FileText,
  Mail,
  Shield,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const FEATURES = [
  {
    icon: FileText,
    title: 'Professional Invoices',
    description:
      'Create and send beautiful PDF invoices in seconds. Auto-numbered, branded with your logo.',
    gradient: 'from-blue-500/20 to-cyan-500/20',
    iconColor: 'text-blue-500',
  },
  {
    icon: Sparkles,
    title: 'AI Follow-ups',
    description:
      'When invoices go overdue, AI drafts tactful follow-up emails that escalate in tone over time.',
    gradient: 'from-violet-500/20 to-purple-500/20',
    iconColor: 'text-violet-500',
  },
  {
    icon: Shield,
    title: 'Human-in-the-Loop',
    description:
      'Nothing is sent without your approval. Review, edit, or regenerate every email before it reaches your client.',
    gradient: 'from-emerald-500/20 to-green-500/20',
    iconColor: 'text-emerald-500',
  },
  {
    icon: TrendingUp,
    title: 'Dashboard Analytics',
    description:
      'Track outstanding amounts, collection rates, and average days to pay — all in one place.',
    gradient: 'from-orange-500/20 to-amber-500/20',
    iconColor: 'text-orange-500',
  },
  {
    icon: Calendar,
    title: 'Calendar View',
    description:
      'Visualize due dates on a month grid. Never miss a deadline or forget to follow up.',
    gradient: 'from-pink-500/20 to-rose-500/20',
    iconColor: 'text-pink-500',
  },
  {
    icon: Mail,
    title: 'Email Delivery',
    description:
      'Invoices and follow-ups are delivered via Resend with real-time delivery confirmation.',
    gradient: 'from-sky-500/20 to-indigo-500/20',
    iconColor: 'text-sky-500',
  },
];

const STEPS = [
  {
    step: '1',
    title: 'Create & Send',
    description: 'Add your client, create an invoice, and send it with one click. A professional PDF is attached automatically.',
    icon: FileText,
  },
  {
    step: '2',
    title: 'AI Drafts Follow-ups',
    description: 'When an invoice becomes overdue, AI drafts a polite follow-up email. The tone escalates automatically over time.',
    icon: Sparkles,
  },
  {
    step: '3',
    title: 'You Approve & Get Paid',
    description: 'Review each draft, edit if needed, and hit send. Mark as paid when the money lands. Celebrate with confetti.',
    icon: CheckCircle2,
  },
];

const TECH_BADGES = [
  'Next.js 14',
  'TypeScript',
  'Tailwind CSS',
  'Supabase',
  'Google Gemini',
  'LangGraph',
  'Resend',
  'pdfkit',
  'Vitest',
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <nav className="container flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600">
              <Zap className="h-4 w-4 text-white" />
            </div>
            PayNudge
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: 'sm' }), 'bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:from-blue-700 hover:to-violet-700 border-0')}
            >
              Get started free
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          {/* Background glow effects */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-500/10 to-violet-500/10 blur-3xl" />
            <div className="absolute -bottom-20 left-1/4 h-[300px] w-[400px] rounded-full bg-gradient-to-r from-emerald-500/5 to-cyan-500/5 blur-3xl" />
          </div>

          <div className="container relative flex flex-col items-center gap-8 pb-24 pt-20 text-center md:pt-32">
            <div className="flex items-center gap-2 rounded-full border border-border/50 bg-card px-4 py-2 text-sm shadow-sm">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-violet-600">
                <Sparkles className="h-3 w-3 text-white" />
              </span>
              <span className="text-muted-foreground">AI-powered invoice follow-ups</span>
            </div>

            <h1 className="max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
              Stop chasing payments.
              <br />
              <span className="bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-violet-400 dark:to-purple-400">
                Let AI do it for you.
              </span>
            </h1>

            <p className="max-w-2xl text-lg text-muted-foreground md:text-xl">
              Create invoices, track payments, and let AI draft follow-up emails for overdue
              invoices — with you approving every message before it&apos;s sent.
            </p>

            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <Link
                href="/signup"
                className={cn(
                  buttonVariants({ size: 'lg' }),
                  'gap-2 bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/25 hover:from-blue-700 hover:to-violet-700 hover:shadow-blue-500/30 border-0 px-8',
                )}
              >
                Start for free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className={buttonVariants({ variant: 'outline', size: 'lg' })}
              >
                Log in to your account
              </Link>
            </div>

            <p className="text-sm text-muted-foreground/70">
              No credit card required · Free tier available · Set up in 30 seconds
            </p>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t bg-muted/40 py-24">
          <div className="container">
            <div className="mb-16 text-center">
              <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">How it works</p>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Three steps to get paid faster</h2>
            </div>

            <div className="relative mx-auto max-w-4xl">
              {/* Connector line (desktop) */}
              <div className="absolute left-0 right-0 top-12 hidden h-0.5 bg-gradient-to-r from-blue-500/50 via-violet-500/50 to-emerald-500/50 md:block" />

              <div className="grid gap-12 md:grid-cols-3 md:gap-8">
                {STEPS.map((step) => (
                  <div key={step.step} className="relative flex flex-col items-center text-center">
                    <div className="relative z-10 mb-6 flex h-24 w-24 flex-col items-center justify-center rounded-2xl border bg-card shadow-sm">
                      <step.icon className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                      <span className="mt-1 text-xs font-bold text-muted-foreground">STEP {step.step}</span>
                    </div>
                    <h3 className="mb-2 text-lg font-bold">{step.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Features grid */}
        <section className="py-24">
          <div className="container">
            <div className="mb-16 text-center">
              <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">Features</p>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything you need to get paid</h2>
              <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
                A complete invoicing workflow with AI automation built in. No more spreadsheets, no more awkward emails.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="group relative overflow-hidden rounded-xl border bg-card p-6 transition-all hover:shadow-lg hover:-translate-y-1"
                >
                  {/* Gradient background on hover */}
                  <div className={cn('absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity group-hover:opacity-100', feature.gradient)} />
                  <div className="relative">
                    <div className={cn('mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted', feature.iconColor)}>
                      <feature.icon className="h-6 w-6" />
                    </div>
                    <h3 className="mb-2 font-bold">{feature.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Escalation tiers */}
        <section className="border-t bg-muted/40 py-24">
          <div className="container">
            <div className="mb-16 text-center">
              <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Smart escalation</p>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">AI adjusts tone automatically</h2>
              <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
                The longer an invoice stays overdue, the firmer the follow-up becomes. You control the timing.
              </p>
            </div>

            <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-4 w-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 shadow-sm shadow-green-500/30" />
                  <span className="font-bold">Polite</span>
                </div>
                <p className="mb-3 text-sm text-muted-foreground">
                  Friendly reminder. Assumes the client simply forgot. Gives them the benefit of the doubt.
                </p>
                <div className="rounded-md bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                  Triggers at day 1+
                </div>
              </div>
              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-4 w-4 rounded-full bg-gradient-to-br from-amber-400 to-orange-600 shadow-sm shadow-amber-500/30" />
                  <span className="font-bold">Firm</span>
                </div>
                <p className="mb-3 text-sm text-muted-foreground">
                  Professional and clear. Payment is noticeably overdue and should be settled promptly.
                </p>
                <div className="rounded-md bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                  Triggers at day 7+
                </div>
              </div>
              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-4 w-4 rounded-full bg-gradient-to-br from-red-400 to-rose-600 shadow-sm shadow-red-500/30" />
                  <span className="font-bold">Final Notice</span>
                </div>
                <p className="mb-3 text-sm text-muted-foreground">
                  Urgent and direct. Clear statement that this is the last reminder before further action.
                </p>
                <div className="rounded-md bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                  Triggers at day 14+
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Tech stack */}
        <section className="py-24">
          <div className="container text-center">
            <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-pink-600 dark:text-pink-400">Tech stack</p>
            <h2 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">Built with modern tools</h2>
            <p className="mx-auto mb-10 max-w-xl text-muted-foreground">
              Production-grade architecture. Property-based tested. Type-safe end to end. 380+ tests.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {TECH_BADGES.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border bg-card px-4 py-2 text-sm font-medium shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="relative overflow-hidden border-t py-24">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-blue-500/5 to-violet-500/5" />
          <div className="container relative flex flex-col items-center gap-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 shadow-lg shadow-blue-500/25">
              <Zap className="h-8 w-8 text-white" />
            </div>
            <h2 className="max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">
              Ready to stop chasing payments?
            </h2>
            <p className="max-w-lg text-lg text-muted-foreground">
              Create your free account in 30 seconds. Start sending invoices and let AI handle the
              awkward follow-ups.
            </p>
            <Link
              href="/signup"
              className={cn(
                buttonVariants({ size: 'lg' }),
                'gap-2 bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/25 hover:from-blue-700 hover:to-violet-700 border-0 px-8',
              )}
            >
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-10">
        <div className="container flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2 font-semibold">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-blue-600 to-violet-600">
              <Zap className="h-3.5 w-3.5 text-white" />
            </div>
            PayNudge
          </div>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} PayNudge. Built as a proof-of-work project.
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
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
