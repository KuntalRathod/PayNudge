import Link from 'next/link';
import {
  ArrowRight,
  BellRing,
  Calendar,
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
  },
  {
    icon: Sparkles,
    title: 'AI Follow-ups',
    description:
      'When invoices go overdue, AI drafts tactful follow-up emails that escalate in tone over time.',
  },
  {
    icon: Shield,
    title: 'Human-in-the-Loop',
    description:
      'Nothing is sent without your approval. Review, edit, or regenerate every email before it reaches your client.',
  },
  {
    icon: TrendingUp,
    title: 'Dashboard Analytics',
    description:
      'Track outstanding amounts, collection rates, and average days to pay — all in one place.',
  },
  {
    icon: Calendar,
    title: 'Calendar View',
    description:
      'Visualize due dates on a month grid. Never miss a deadline or forget to follow up.',
  },
  {
    icon: Mail,
    title: 'Email Delivery',
    description:
      'Invoices and follow-ups are delivered via Resend with real-time delivery confirmation.',
  },
];

const STEPS = [
  {
    step: '1',
    title: 'Create & Send',
    description: 'Add your client, create an invoice, and send it with one click. A PDF is attached automatically.',
  },
  {
    step: '2',
    title: 'AI Drafts Follow-ups',
    description: 'When an invoice becomes overdue, AI drafts a polite follow-up email. The tone escalates over time.',
  },
  {
    step: '3',
    title: 'You Approve & Get Paid',
    description: 'Review each draft, edit if needed, and hit send. Mark as paid when the money lands.',
  },
];

const TECH_BADGES = [
  'Next.js',
  'TypeScript',
  'Tailwind CSS',
  'Supabase',
  'Google Gemini',
  'LangGraph',
  'Resend',
  'pdfkit',
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <nav className="container flex h-14 items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight">
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
              className={buttonVariants({ size: 'sm' })}
            >
              Get started free
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="container flex flex-col items-center gap-8 pb-20 pt-20 text-center md:pt-32">
          <div className="flex items-center gap-2 rounded-full border bg-muted px-4 py-1.5 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4 text-amber-500" />
            AI-powered invoice follow-ups
          </div>

          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Stop chasing payments.
            <br />
            <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-violet-400">Let AI do it for you.</span>
          </h1>

          <p className="max-w-xl text-lg text-muted-foreground">
            Create invoices, track payments, and let AI draft follow-up emails for overdue
            invoices — with you approving every message before it&apos;s sent.
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: 'lg' }), 'gap-2')}
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

          <p className="text-sm text-muted-foreground">
            No credit card required. Free tier available.
          </p>
        </section>

        {/* How it works */}
        <section className="border-t bg-muted/50 py-20">
          <div className="container">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight">How it works</h2>
              <p className="mt-2 text-muted-foreground">
                Three steps from invoice to payment.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-3">
              {STEPS.map((step) => (
                <div key={step.step} className="relative flex flex-col items-center text-center">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-xl font-bold text-background">
                    {step.step}
                  </div>
                  <h3 className="mb-2 text-lg font-semibold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features grid */}
        <section className="py-20">
          <div className="container">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight">Everything you need</h2>
              <p className="mt-2 text-muted-foreground">
                A complete invoicing workflow with AI automation built in.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-lg border bg-card p-6 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                >
                  <feature.icon className="mb-3 h-8 w-8 text-blue-600 dark:text-blue-400" />
                  <h3 className="mb-2 font-semibold">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Escalation tiers */}
        <section className="border-t bg-muted/50 py-20">
          <div className="container">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight">Smart escalation</h2>
              <p className="mt-2 text-muted-foreground">
                AI adjusts tone based on how overdue the invoice is.
              </p>
            </div>

            <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-3">
              <div className="rounded-lg border bg-card p-5">
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                  <span className="text-sm font-semibold">Polite</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Day 1+ — Friendly reminder. Assumes the client simply forgot.
                </p>
              </div>
              <div className="rounded-lg border bg-card p-5">
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-amber-500" />
                  <span className="text-sm font-semibold">Firm</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Day 7+ — Professional and clear. Payment is noticeably overdue.
                </p>
              </div>
              <div className="rounded-lg border bg-card p-5">
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-red-500" />
                  <span className="text-sm font-semibold">Final Notice</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Day 14+ — Urgent and direct. Mentions consequences of non-payment.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Tech stack */}
        <section className="py-20">
          <div className="container text-center">
            <h2 className="mb-2 text-3xl font-bold tracking-tight">Built with modern tools</h2>
            <p className="mb-8 text-muted-foreground">
              Production-grade architecture. Property-based tested. Type-safe end to end.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {TECH_BADGES.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t bg-foreground py-16 text-background">
          <div className="container flex flex-col items-center gap-6 text-center">
            <Zap className="h-10 w-10" />
            <h2 className="text-3xl font-bold tracking-tight">
              Ready to stop chasing payments?
            </h2>
            <p className="max-w-md opacity-70">
              Create your free account in 30 seconds. Start sending invoices and let AI handle the
              awkward follow-ups.
            </p>
            <Link
              href="/signup"
              className={cn(
                buttonVariants({ size: 'lg', variant: 'outline' }),
                'border-background/30 bg-background text-foreground hover:bg-background/90',
              )}
            >
              Get started free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} PayNudge. Built as a proof-of-work project.
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/login" className="hover:text-foreground">
              Log in
            </Link>
            <Link href="/signup" className="hover:text-foreground">
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
