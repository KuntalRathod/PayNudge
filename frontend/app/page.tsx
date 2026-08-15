import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Check,
  Clock,
  FileText,
  Mail,
  MousePointerClick,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PLANS } from './pricing/plans';

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900" data-theme="light">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b bg-white backdrop-blur-sm">
        <nav className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <Zap className="h-5 w-5 text-blue-600" />
            <span className="text-lg">PayNudge</span>
          </Link>

          <div className="hidden items-center gap-8 text-sm md:flex">
            <a href="#how-it-works" className="text-slate-500 hover:text-slate-900">How it works</a>
            <a href="#features" className="text-slate-500 hover:text-slate-900">Features</a>
            <a href="#pricing" className="text-slate-500 hover:text-slate-900">Pricing</a>
            <a href="#faq" className="text-slate-500 hover:text-slate-900">FAQ</a>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Log in
            </Link>
            <Link href="/signup" className={cn(buttonVariants({ size: 'sm' }), 'bg-blue-600 hover:bg-blue-700 text-white')}>
              Start free
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* ─────────── HERO ─────────── */}
        <section className="py-24 md:py-32">
          <div className="container flex flex-col items-center text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5 text-sm font-medium text-blue-700 ">
              <Sparkles className="h-4 w-4" />
              AI writes your follow-up emails
            </div>

            <h1 className="max-w-3xl text-5xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl md:text-7xl">
              Invoice clients.
              <br />
              <span className="text-blue-600 text-blue-600">Get paid faster.</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-500">
              PayNudge creates professional invoices, detects overdue payments, and
              writes the reminder emails your clients need to hear — so you never have to.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className={cn(buttonVariants({ size: 'lg' }), 'bg-blue-600 hover:bg-blue-700 text-white px-8 text-base h-12')}
              >
                Create free account
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
              <a
                href="#how-it-works"
                className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'px-8 text-base h-12')}
              >
                See how it works
              </a>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-slate-500">
              <span className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /> Free forever plan</span>
              <span className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /> No credit card required</span>
              <span className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /> Setup in 30 seconds</span>
            </div>
          </div>
        </section>

        {/* ─────────── PROBLEM ─────────── */}
        <section className="border-y py-20">
          <div className="container">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                You did the work. Now you&apos;re chasing money like it&apos;s a second job.
              </h2>
              <p className="mt-4 text-lg text-slate-500">
                Most freelancers lose <span className="font-semibold text-slate-900">$5,000+ per year</span> to late payments.
                Not because clients are malicious — they just forget. And sending that &ldquo;hey,
                just checking in&rdquo; email for the 3rd time? Exhausting.
              </p>
            </div>

            <div className="mt-14 grid gap-8 sm:grid-cols-3">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 ">
                  <Clock className="h-6 w-6 text-red-500" />
                </div>
                <p className="text-2xl font-bold">14+ hours</p>
                <p className="mt-1 text-sm text-slate-500">wasted per month on payment reminders</p>
              </div>
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 ">
                  <ReceiptText className="h-6 w-6 text-amber-500" />
                </div>
                <p className="text-2xl font-bold">1 in 3</p>
                <p className="mt-1 text-sm text-slate-500">invoices are paid late</p>
              </div>
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 ">
                  <Mail className="h-6 w-6 text-emerald-500" />
                </div>
                <p className="text-2xl font-bold">2x faster</p>
                <p className="mt-1 text-sm text-slate-500">payment when you consistently follow up</p>
              </div>
            </div>
          </div>
        </section>

        {/* ─────────── HOW IT WORKS ─────────── */}
        <section id="how-it-works" className="scroll-mt-20 py-24">
          <div className="container">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-blue-600 text-blue-600">How it works</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                You invoice. AI reminds. You get paid.
              </h2>
            </div>

            <div className="mx-auto mt-16 max-w-4xl">
              <div className="grid gap-12 md:grid-cols-3">
                {/* Step 1 */}
                <div className="relative">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600 ">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">1</span>
                    <h3 className="font-semibold">Send an invoice</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-500">
                    Enter the client, amount, and due date. We generate a branded PDF and email it instantly.
                  </p>
                </div>

                {/* Step 2 */}
                <div className="relative">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 text-violet-600 ">
                    <Bot className="h-6 w-6" />
                  </div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">2</span>
                    <h3 className="font-semibold">AI writes the follow-up</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-500">
                    Invoice overdue? AI drafts a professional reminder — polite first, then firmer if payment stays late.
                  </p>
                </div>

                {/* Step 3 */}
                <div className="relative">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 ">
                    <MousePointerClick className="h-6 w-6" />
                  </div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">3</span>
                    <h3 className="font-semibold">You click approve</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-500">
                    Read the email, edit if you want, send it. When the client pays, mark it done. No more nagging.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─────────── AI TONE DEMO ─────────── */}
        <section className="border-y py-24">
          <div className="container">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-violet-600 text-violet-600">Smart escalation</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                The right tone, at the right time
              </h2>
              <p className="mt-4 text-slate-500">
                Day 1 it&apos;s friendly. Day 7 it&apos;s firm. Day 14 it&apos;s a final notice. All written for you.
              </p>
            </div>

            <div className="mx-auto mt-14 max-w-3xl space-y-5">
              {/* Polite */}
              <div className="rounded-xl border p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-emerald-500" />
                    <span className="font-semibold">Polite</span>
                    <span className="ml-2 rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ">Day 1</span>
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-sm italic text-slate-500">
                    &ldquo;Hi Sarah, just a quick heads up — invoice #12 for $2,400 was due yesterday.
                    I am sure it just slipped through! Here is the payment link whenever you get a moment. Thanks!&rdquo;
                  </p>
                </div>
              </div>

              {/* Firm */}
              <div className="rounded-xl border p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-amber-500" />
                    <span className="font-semibold">Firm</span>
                    <span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ">Day 7</span>
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-sm italic text-slate-500">
                    &ldquo;Hi Sarah, invoice #12 for $2,400 is now 7 days past due. Could you let me know when
                    I can expect payment? I have attached the invoice again for your records.&rdquo;
                  </p>
                </div>
              </div>

              {/* Final */}
              <div className="rounded-xl border p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-red-500" />
                    <span className="font-semibold">Final Notice</span>
                    <span className="ml-2 rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ">Day 14</span>
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-sm italic text-slate-500">
                    &ldquo;Hi Sarah, this is a final notice regarding invoice #12 ($2,400), which is now
                    14 days overdue. Please arrange payment by end of this week to avoid further action on my end.&rdquo;
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─────────── FEATURES ─────────── */}
        <section id="features" className="scroll-mt-20 py-24">
          <div className="container">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-blue-600 text-blue-600">Features</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                More than just invoicing
              </h2>
              <p className="mt-4 text-slate-500">
                Everything you need from first invoice to final payment, in one clean dashboard.
              </p>
            </div>

            <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: FileText, title: 'Branded PDF invoices', desc: 'Your logo, bank details, and payment terms. Generated instantly, emailed directly.', color: 'text-blue-500' },
                { icon: Bot, title: 'AI-written reminders', desc: 'Never type "just checking in" again. AI writes contextual, professional follow-ups.', color: 'text-violet-500' },
                { icon: ShieldCheck, title: 'Human approval always', desc: 'AI proposes, you decide. Every email goes through you before reaching the client.', color: 'text-emerald-500' },
                { icon: Sparkles, title: 'Smart tone escalation', desc: 'Starts polite. Gets firmer. Stops when they pay. Fully configurable timing.', color: 'text-amber-500' },
                { icon: BadgeCheck, title: 'Real-time dashboard', desc: 'Outstanding total, overdue amounts, avg. days to pay, collection rate — all live.', color: 'text-pink-500' },
                { icon: Mail, title: 'Confirmed delivery', desc: 'Know your invoice and reminders actually arrived. No more "I never got it" excuses.', color: 'text-sky-500' },
              ].map((f) => (
                <div key={f.title} className="rounded-xl border p-6 transition-colors hover:bg-slate-50">
                  <f.icon className={cn('mb-4 h-6 w-6', f.color)} />
                  <h3 className="mb-2 font-semibold">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-500">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─────────── PRICING ─────────── */}
        <section id="pricing" className="scroll-mt-20 border-y py-24">
          <div className="container">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-blue-600 text-blue-600">Pricing</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                One recovered late payment pays for a year of Pro
              </h2>
              <p className="mt-4 text-slate-500">
                Start free with 3 clients and 5 invoices/month. Upgrade when you need AI follow-ups.
              </p>
            </div>

            <div className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-3">
              {PLANS.map((plan) => (
                <div
                  key={plan.name}
                  className={cn(
                    'relative flex flex-col rounded-2xl border p-7',
                    plan.highlighted
                      ? 'border-blue-600 shadow-lg shadow-blue-500/10 '
                      : '',
                  )}
                >
                  {plan.highlighted ? (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
                      Most popular
                    </span>
                  ) : null}

                  <h3 className="text-lg font-bold">{plan.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">{plan.description}</p>

                  <div className="mt-6 flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold tracking-tight">{plan.price}</span>
                    <span className="text-slate-500">{plan.period}</span>
                  </div>
                  {plan.yearlyNote ? (
                    <p className="mt-1 text-xs text-slate-500">{plan.yearlyNote}</p>
                  ) : <p className="mt-1 text-xs text-transparent select-none">—</p>}

                  <Link
                    href="/signup"
                    className={cn(
                      buttonVariants({ variant: plan.highlighted ? 'default' : 'outline' }),
                      'mt-7 w-full',
                      plan.highlighted && 'bg-blue-600 hover:bg-blue-700 text-white',
                    )}
                  >
                    {plan.cta}
                  </Link>

                  <ul className="mt-8 flex-1 space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-sm">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 text-blue-600" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <p className="mt-10 text-center text-sm text-slate-500">
              14-day free trial on all paid plans. No credit card to start. Cancel anytime.
            </p>
          </div>
        </section>

        {/* ─────────── FAQ ─────────── */}
        <section id="faq" className="scroll-mt-20 py-24">
          <div className="container">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Questions?</h2>
            </div>

            <div className="mx-auto mt-14 grid max-w-4xl gap-8 sm:grid-cols-2">
              {[
                { q: 'Will it email my clients without asking?', a: 'Never. AI writes a draft, you read it, you send it. Nothing leaves without your explicit click.' },
                { q: 'Do I need a credit card to start?', a: 'No. The Free plan is completely free — no trial, no card, no catch. Use it as long as you like.' },
                { q: 'Can I edit the AI emails?', a: 'Yes. Change the subject, rewrite the body, regenerate with a different tone. You have full control.' },
                { q: 'What happens when they pay?', a: 'Mark it as paid. All pending reminders are instantly canceled. No embarrassing follow-up after they already paid.' },
                { q: 'Can I cancel anytime?', a: 'Yes. Downgrade to Free or cancel completely whenever you want. Your data stays yours.' },
                { q: 'Is my data safe?', a: 'Every account is isolated at the database level (Row Level Security). Your data is invisible to every other user.' },
              ].map((faq) => (
                <div key={faq.q}>
                  <h3 className="mb-2 font-semibold">{faq.q}</h3>
                  <p className="text-sm leading-relaxed text-slate-500">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─────────── FINAL CTA ─────────── */}
        <section className="border-t py-24">
          <div className="container flex flex-col items-center text-center">
            <Zap className="mb-6 h-10 w-10 text-blue-600 text-blue-600" />
            <h2 className="max-w-lg text-3xl font-bold tracking-tight sm:text-4xl">
              Your next overdue invoice could chase itself
            </h2>
            <p className="mt-4 max-w-md text-slate-500">
              Create your free account, send an invoice, and see what happens when it goes overdue. Takes 30 seconds.
            </p>
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: 'lg' }), 'mt-8 bg-blue-600 hover:bg-blue-700 text-white px-8 text-base h-12')}
            >
              Start free — no card needed
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-10">
        <div className="container flex flex-col items-center justify-between gap-5 sm:flex-row">
          <div className="flex items-center gap-2 font-bold">
            <Zap className="h-4 w-4 text-blue-600" />
            PayNudge
          </div>
          <p className="text-sm text-slate-500">© {new Date().getFullYear()} PayNudge. All rights reserved.</p>
          <div className="flex items-center gap-5 text-sm text-slate-500">
            <a href="#pricing" className="hover:text-slate-900">Pricing</a>
            <Link href="/login" className="hover:text-slate-900">Log in</Link>
            <Link href="/signup" className="hover:text-slate-900">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
