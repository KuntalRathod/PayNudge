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
    description: 'Create and send PDF invoices in seconds. Auto-numbered, branded with your logo.',
    iconColor: 'text-blue-500',
  },
  {
    icon: Sparkles,
    title: 'AI Follow-ups',
    description: 'AI drafts tactful follow-up emails that escalate in tone as invoices age.',
    iconColor: 'text-violet-500',
  },
  {
    icon: Shield,
    title: 'Human-in-the-Loop',
    description: 'Nothing is sent without your approval. Review and edit every email.',
    iconColor: 'text-emerald-500',
  },
  {
    icon: TrendingUp,
    title: 'Dashboard Analytics',
    description: 'Outstanding amounts, collection rates, average days to pay — at a glance.',
    iconColor: 'text-orange-500',
  },
  {
    icon: Calendar,
    title: 'Calendar View',
    description: 'Visualize due dates on a month grid. Never miss a deadline.',
    iconColor: 'text-pink-500',
  },
  {
    icon: Mail,
    title: 'Email Delivery',
    description: 'Delivered via Resend with real-time confirmation and timeout handling.',
    iconColor: 'text-sky-500',
  },
];

const STEPS = [
  {
    step: '01',
    title: 'Create & Send',
    description: 'Add a client, create an invoice, send it. A professional PDF is attached automatically.',
  },
  {
    step: '02',
    title: 'AI Drafts Follow-ups',
    description: 'When overdue, AI drafts a follow-up email. Tone escalates over time: Polite → Firm → Final Notice.',
  },
  {
    step: '03',
    title: 'Approve & Get Paid',
    description: 'Review, edit if needed, approve. Mark as paid when money lands. The chase stops automatically.',
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
  '380+ Tests',
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <nav className="container flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm font-bold tracking-tight">
            <Zap className="h-4 w-4" />
            PayNudge
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Log in
            </Link>
            <Link href="/signup" className={cn(buttonVariants({ size: 'sm' }), 'rounded-full px-4')}>
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border/40">
          {/* Grid lines */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-[10%] w-px bg-border/30 sm:left-[15%]" />
            <div className="absolute inset-y-0 right-[10%] w-px bg-border/30 sm:right-[15%]" />
            <div className="absolute inset-y-0 left-1/2 w-px bg-border/20" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-border/20" />
            <div className="absolute inset-x-0 bottom-1/4 h-px bg-border/20" />
          </div>

          {/* Subtle radial glow */}
          <div className="pointer-events-none absolute left-1/2 top-0 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-b from-blue-500/5 to-transparent blur-3xl" />

          <div className="container relative flex flex-col items-center gap-6 py-28 text-center md:py-40">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              AI-powered invoice automation
            </p>

            <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Stop chasing
              <br />
              payments manually.
            </h1>

            <p className="max-w-lg text-base text-muted-foreground md:text-lg">
              Create invoices. Track payments. Let AI draft follow-up emails when things go overdue — with your approval on every message.
            </p>

            <div className="flex items-center gap-3 pt-2">
              <Link
                href="/signup"
                className={cn(buttonVariants({ size: 'lg' }), 'rounded-full px-8')}
              >
                Start for free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'rounded-full px-8')}
              >
                Log in
              </Link>
            </div>

            <p className="pt-2 text-xs text-muted-foreground/60">
              No credit card · Free tier · 30 second setup
            </p>
          </div>
        </section>

        {/* How it works */}
        <section className="relative border-b border-border/40">
          {/* Grid lines */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-[10%] w-px bg-border/30 sm:left-[15%]" />
            <div className="absolute inset-y-0 right-[10%] w-px bg-border/30 sm:right-[15%]" />
          </div>

          <div className="container relative py-24">
            <p className="mb-2 text-center text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              How it works
            </p>
            <h2 className="mb-16 text-center text-3xl font-bold tracking-tight">
              Three steps to get paid
            </h2>

            <div className="grid gap-12 md:grid-cols-3 md:gap-0">
              {STEPS.map((step, index) => (
                <div
                  key={step.step}
                  className={cn(
                    'flex flex-col items-center text-center md:px-8',
                    index < STEPS.length - 1 && 'md:border-r md:border-border/40',
                  )}
                >
                  <span className="mb-4 font-mono text-4xl font-light text-muted-foreground/40">
                    {step.step}
                  </span>
                  <h3 className="mb-2 text-lg font-semibold">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="relative border-b border-border/40">
          {/* Grid lines */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-[10%] w-px bg-border/30 sm:left-[15%]" />
            <div className="absolute inset-y-0 right-[10%] w-px bg-border/30 sm:right-[15%]" />
          </div>

          <div className="container relative py-24">
            <p className="mb-2 text-center text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Features
            </p>
            <h2 className="mb-4 text-center text-3xl font-bold tracking-tight">
              Everything you need
            </h2>
            <p className="mx-auto mb-16 max-w-md text-center text-sm text-muted-foreground">
              A complete invoicing workflow with AI automation. No more spreadsheets, no more awkward emails.
            </p>

            <div className="grid gap-px overflow-hidden rounded-xl border border-border/40 bg-border/40 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="flex flex-col gap-3 bg-background p-8 transition-colors hover:bg-muted/30"
                >
                  <feature.icon className={cn('h-5 w-5', feature.iconColor)} />
                  <h3 className="text-sm font-semibold">{feature.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Escalation */}
        <section className="relative border-b border-border/40">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-[10%] w-px bg-border/30 sm:left-[15%]" />
            <div className="absolute inset-y-0 right-[10%] w-px bg-border/30 sm:right-[15%]" />
          </div>

          <div className="container relative py-24">
            <p className="mb-2 text-center text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Escalation
            </p>
            <h2 className="mb-4 text-center text-3xl font-bold tracking-tight">
              AI adjusts tone automatically
            </h2>
            <p className="mx-auto mb-16 max-w-md text-center text-sm text-muted-foreground">
              The longer an invoice stays overdue, the firmer the follow-up becomes. Fully configurable.
            </p>

            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              <div className="flex items-center gap-4 rounded-lg border border-border/40 bg-background p-5 transition-colors hover:bg-muted/30">
                <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">Polite</span>
                    <span className="font-mono text-xs text-muted-foreground">day 1+</span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">Friendly reminder. Benefit of the doubt.</p>
                </div>
              </div>
              <div className="flex items-center gap-4 rounded-lg border border-border/40 bg-background p-5 transition-colors hover:bg-muted/30">
                <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" />
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">Firm</span>
                    <span className="font-mono text-xs text-muted-foreground">day 7+</span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">Professional and clear. Payment is overdue.</p>
                </div>
              </div>
              <div className="flex items-center gap-4 rounded-lg border border-border/40 bg-background p-5 transition-colors hover:bg-muted/30">
                <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">Final Notice</span>
                    <span className="font-mono text-xs text-muted-foreground">day 14+</span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">Urgent. Last reminder before further action.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Tech stack */}
        <section className="relative border-b border-border/40">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-[10%] w-px bg-border/30 sm:left-[15%]" />
            <div className="absolute inset-y-0 right-[10%] w-px bg-border/30 sm:right-[15%]" />
          </div>

          <div className="container relative py-24 text-center">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Stack
            </p>
            <h2 className="mb-4 text-3xl font-bold tracking-tight">Built with modern tools</h2>
            <p className="mx-auto mb-10 max-w-md text-sm text-muted-foreground">
              Production-grade architecture. Property-based tested. Type-safe end to end.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {TECH_BADGES.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-border/60 px-3.5 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="relative">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-[10%] w-px bg-border/30 sm:left-[15%]" />
            <div className="absolute inset-y-0 right-[10%] w-px bg-border/30 sm:right-[15%]" />
            <div className="absolute inset-y-0 left-1/2 w-px bg-border/20" />
          </div>

          <div className="container relative flex flex-col items-center gap-6 py-28 text-center">
            <h2 className="max-w-md text-3xl font-bold tracking-tight">
              Ready to get paid faster?
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Free account. 30 second setup. Start sending invoices today.
            </p>
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: 'lg' }), 'rounded-full px-8')}
            >
              Get started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 py-8">
        <div className="container flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="h-3.5 w-3.5" />
            PayNudge
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} PayNudge
          </p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link href="/login" className="transition-colors hover:text-foreground">Log in</Link>
            <Link href="/signup" className="transition-colors hover:text-foreground">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
