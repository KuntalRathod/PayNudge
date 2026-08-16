'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Check,
  Clock,
  FileText,
  Mail,
  MousePointerClick,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Star,
  X,
  Zap,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { CornerBrackets } from '@/components/landing/corner-brackets';
import { cn } from '@/lib/utils';

const METRICS = [
  { value: '3 tiers', label: 'AI escalation tones', desc: 'Polite, Firm, and Final Notice — drafted automatically as invoices age' },
  { value: '30s', label: 'to send an invoice', desc: 'Client, amount, due date, send. A branded PDF attaches itself' },
  { value: '100%', label: 'human-approved', desc: 'Every AI-drafted email is reviewed by you before it reaches a client' },
  { value: '0', label: 'spreadsheets needed', desc: 'Dashboard, timeline, and calendar replace manual tracking' },
];

const COMPARISON = [
  { old: 'Manually writing "just checking in" emails every week', new: 'AI drafts the follow-up the moment an invoice goes overdue' },
  { old: 'Guessing which tone to use with a late client', new: 'Tone escalates automatically: Polite → Firm → Final Notice' },
  { old: 'Losing track of who owes what in a spreadsheet', new: 'One dashboard shows outstanding, overdue, and collected totals' },
  { old: 'Awkward reminder sent after they already paid', new: 'Follow-ups cancel instantly the moment you mark it paid' },
  { old: 'Invoices as plain text with no branding', new: 'Branded PDF invoices with your logo and payment terms' },
];

const FEATURES = [
  { icon: FileText, title: 'Branded PDF invoices', desc: 'Your logo, bank details, and payment terms. Generated instantly, emailed directly.' },
  { icon: Bot, title: 'AI-written reminders', desc: 'Never type "just checking in" again. AI writes contextual, professional follow-ups.' },
  { icon: ShieldCheck, title: 'Human approval always', desc: 'AI proposes, you decide. Every email goes through you before reaching the client.' },
  { icon: Sparkles, title: 'Smart tone escalation', desc: 'Starts polite. Gets firmer. Stops when they pay. Fully configurable timing.' },
  { icon: ReceiptText, title: 'Real-time dashboard', desc: 'Outstanding total, overdue amounts, avg. days to pay, collection rate — all live.' },
  { icon: Mail, title: 'Confirmed delivery', desc: 'Know your invoice and reminders actually arrived. No more "I never got it" excuses.' },
];

const FAQS = [
  { q: 'Will it email my clients without asking?', a: 'Never. AI writes a draft, you read it, you send it. Nothing leaves without your explicit click.' },
  { q: 'Do I need a credit card to start?', a: 'No. The Free plan is completely free — no trial, no card, no catch. Use it as long as you like.' },
  { q: 'Can I edit the AI emails?', a: 'Yes. Change the subject, rewrite the body, regenerate with a different tone. You have full control.' },
  { q: 'What happens when they pay?', a: 'Mark it as paid. All pending reminders are instantly canceled. No embarrassing follow-up after they already paid.' },
  { q: 'Can I cancel anytime?', a: 'Yes. Downgrade to Free or cancel completely whenever you want. Your data stays yours.' },
  { q: 'Is my data safe?', a: 'Every account is isolated at the database level (Row Level Security). Your data is invisible to every other user.' },
  { q: 'Who is PayNudge built for?', a: 'Freelancers, consultants, and small agencies who invoice clients directly and are tired of chasing payments manually.' },
  { q: 'What if AI drafts something wrong?', a: 'Every draft is validated before it reaches you, and you can edit or regenerate it in a different tone before sending.' },
];

/** Small L-bracket-framed button, matching the reference's signature CTA style. */
function BracketButton({
  href,
  children,
  variant = 'solid',
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: 'solid' | 'outline';
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'relative inline-flex h-10 items-center justify-center px-6 text-xs font-bold uppercase tracking-widest transition-colors',
        variant === 'solid'
          ? 'bg-indigo-600 text-white hover:bg-indigo-700'
          : 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50',
        className,
      )}
    >
      <CornerBrackets className={variant === 'solid' ? 'text-indigo-300' : 'text-slate-400'} />
      {children}
    </Link>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      {/* ─────────── NAV ─────────── */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white">
        <nav className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600">
              <Zap className="h-4 w-4 text-white" />
            </span>
            PayNudge
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-xs font-semibold uppercase tracking-widest text-slate-500 hover:text-slate-900">
              Features
            </a>
            <a href="#how-it-works" className="text-xs font-semibold uppercase tracking-widest text-slate-500 hover:text-slate-900">
              How it works
            </a>
            <a href="#faq" className="text-xs font-semibold uppercase tracking-widest text-slate-500 hover:text-slate-900">
              FAQ
            </a>
          </div>

          <div className="flex items-center gap-3">
            <BracketButton href="/signup" className="h-9 px-5">
              Start free
            </BracketButton>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* ─────────── HERO ─────────── */}
        <section className="relative overflow-hidden border-b border-slate-200 bg-white">
          <div className="container relative flex flex-col items-center py-20 text-center md:py-28">
            {/* Vertical lines left and right, aligned to the container's edges */}
            <div aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-slate-200" />
            <div aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-slate-200" />
            <span className="mb-6 inline-flex items-center gap-2 bg-indigo-600 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              AI writes your payment follow-ups
            </span>

            <h1 className="max-w-3xl text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl md:text-[4.5rem]">
              Get Paid
              <br />
              Without the Awkward Emails
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-500 md:text-lg">
              Eliminate manual reminders and slow follow-ups. PayNudge automates
              the chase so you can send an invoice and get back to work.
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <BracketButton href="/signup">Start Free</BracketButton>
              <BracketButton href="#how-it-works" variant="outline">
                See How It Works
              </BracketButton>
            </div>
          </div>
        </section>

        {/* Hatch separator */}
        <div
          aria-hidden="true"
          className="h-10 border-y border-slate-200"
          style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(24,24,27,0.08) 0px, rgba(24,24,27,0.08) 2px, transparent 2px, transparent 10px)' }}
        />

        {/* ─────────── DEEP BANNER ─────────── */}
        <section className="relative overflow-hidden bg-indigo-700 py-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)',
              backgroundSize: '18px 18px',
            }}
          />
          <div className="container relative flex flex-col items-center gap-4 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-indigo-200">
              Trusted by freelancers everywhere
            </p>
            <h2 className="max-w-lg text-2xl font-bold text-white sm:text-3xl">
              Stop chasing. Start invoicing with confidence.
            </h2>
          </div>
        </section>

        {/* ─────────── METRICS ─────────── */}
        <section className="relative border-b border-slate-200 py-16">
          <div className="container relative">
            <div aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-slate-200" />
            <div aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-slate-200" />
            <p className="mb-10 text-center text-xs font-bold uppercase tracking-[0.3em] text-indigo-600">
              [ 01 ] · Built different
            </p>
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {METRICS.map((m) => (
                <div key={m.label} className="border-l-2 border-indigo-600 pl-5">
                  <p className="text-3xl font-extrabold tracking-tight">{m.value}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{m.label}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{m.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─────────── PROBLEM ─────────── */}
        <section className="relative py-20">
          <div className="container relative">
            <div aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-slate-200" />
            <div aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-slate-200" />
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-[0.3em] text-indigo-600">
              [ 02 ] · The problem
            </p>
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                You did the work. Now you&apos;re chasing money like it&apos;s a second job.
              </h2>
              <p className="mt-4 text-lg text-slate-500">
                Most freelancers lose <span className="font-semibold text-slate-900">real income</span> to late payments.
                Not because clients are malicious — they just forget. And sending that &ldquo;hey,
                just checking in&rdquo; email for the 3rd time? Exhausting.
              </p>
            </div>

            <div className="mt-14 grid gap-8 sm:grid-cols-3">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
                  <Clock className="h-6 w-6 text-red-500" />
                </div>
                <p className="text-2xl font-bold">Hours lost</p>
                <p className="mt-1 text-sm text-slate-500">every month writing payment reminders</p>
              </div>
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
                  <ReceiptText className="h-6 w-6 text-amber-500" />
                </div>
                <p className="text-2xl font-bold">Cash flow gaps</p>
                <p className="mt-1 text-sm text-slate-500">from invoices that quietly go overdue</p>
              </div>
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
                  <Mail className="h-6 w-6 text-emerald-500" />
                </div>
                <p className="text-2xl font-bold">Faster payment</p>
                <p className="mt-1 text-sm text-slate-500">when you consistently follow up</p>
              </div>
            </div>
          </div>
        </section>

        {/* Hatch separator */}
        <div
          aria-hidden="true"
          className="h-10 border-y border-slate-200"
          style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(24,24,27,0.08) 0px, rgba(24,24,27,0.08) 2px, transparent 2px, transparent 10px)' }}
        />

        {/* ─────────── HOW IT WORKS ─────────── */}
        <section id="how-it-works" className="relative scroll-mt-20 border-y border-slate-200 bg-slate-50 py-20">
          <div className="container relative">
            <div aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-slate-200" />
            <div aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-slate-200" />
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-[0.3em] text-indigo-600">
              [ 03 ] · How it works
            </p>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                You invoice. AI reminds. You get paid.
              </h2>
            </div>

            <div className="mx-auto mt-16 max-w-4xl">
              <div className="grid gap-12 md:grid-cols-3">
                <div>
                  <div className="relative mb-5 flex h-12 w-12 items-center justify-center bg-indigo-100 text-indigo-600">
                    <CornerBrackets className="text-indigo-300" />
                    <FileText className="h-6 w-6" />
                  </div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">01</span>
                    <h3 className="font-semibold">Send an invoice</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-500">
                    Enter the client, amount, and due date. We generate a branded PDF and email it instantly.
                  </p>
                </div>

                <div>
                  <div className="relative mb-5 flex h-12 w-12 items-center justify-center bg-violet-100 text-violet-600">
                    <CornerBrackets className="text-violet-300" />
                    <Bot className="h-6 w-6" />
                  </div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">02</span>
                    <h3 className="font-semibold">AI writes the follow-up</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-500">
                    Invoice overdue? AI drafts a professional reminder — polite first, then firmer if payment stays late.
                  </p>
                </div>

                <div>
                  <div className="relative mb-5 flex h-12 w-12 items-center justify-center bg-emerald-100 text-emerald-600">
                    <CornerBrackets className="text-emerald-300" />
                    <MousePointerClick className="h-6 w-6" />
                  </div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">03</span>
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
        <section className="relative py-20">
          <div className="container relative">
            <div aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-slate-200" />
            <div aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-slate-200" />
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-[0.3em] text-indigo-600">
              [ 04 ] · Smart escalation
            </p>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                The right tone, at the right time
              </h2>
              <p className="mt-4 text-slate-500">
                Day 1 it&apos;s friendly. Day 7 it&apos;s firm. Day 14 it&apos;s a final notice. All written for you.
              </p>
            </div>

            <div className="mx-auto mt-14 max-w-3xl space-y-5">
              <div className="relative border border-slate-200 p-5">
                <CornerBrackets className="text-slate-300" />
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-emerald-500" />
                  <span className="font-semibold">Polite</span>
                  <span className="ml-2 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Day 1</span>
                </div>
                <div className="bg-slate-50 p-4">
                  <p className="text-sm italic text-slate-500">
                    &ldquo;Hi Sarah, just a quick heads up — invoice #12 for $2,400 was due yesterday.
                    I am sure it just slipped through! Here is the payment link whenever you get a moment. Thanks!&rdquo;
                  </p>
                </div>
              </div>

              <div className="relative border border-slate-200 p-5">
                <CornerBrackets className="text-slate-300" />
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-amber-500" />
                  <span className="font-semibold">Firm</span>
                  <span className="ml-2 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Day 7</span>
                </div>
                <div className="bg-slate-50 p-4">
                  <p className="text-sm italic text-slate-500">
                    &ldquo;Hi Sarah, invoice #12 for $2,400 is now 7 days past due. Could you let me know when
                    I can expect payment? I have attached the invoice again for your records.&rdquo;
                  </p>
                </div>
              </div>

              <div className="relative border border-slate-200 p-5">
                <CornerBrackets className="text-slate-300" />
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-red-500" />
                  <span className="font-semibold">Final Notice</span>
                  <span className="ml-2 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Day 14</span>
                </div>
                <div className="bg-slate-50 p-4">
                  <p className="text-sm italic text-slate-500">
                    &ldquo;Hi Sarah, this is a final notice regarding invoice #12 ($2,400), which is now
                    14 days overdue. Please arrange payment by end of this week to avoid further action on my end.&rdquo;
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Hatch separator */}
        <div
          aria-hidden="true"
          className="h-10 border-y border-slate-200"
          style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(24,24,27,0.08) 0px, rgba(24,24,27,0.08) 2px, transparent 2px, transparent 10px)' }}
        />

        {/* ─────────── BEFORE / AFTER COMPARISON ─────────── */}
        <section className="relative border-y border-slate-200 bg-slate-50 py-20">
          <div className="container relative">
            <div aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-slate-200" />
            <div aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-slate-200" />
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-[0.3em] text-indigo-600">
              [ 05 ] · Why switch
            </p>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                A smarter alternative to manual chasing
              </h2>
              <p className="mt-4 text-slate-500">
                PayNudge replaces scattered reminders and spreadsheets with one automated, approval-gated workflow.
              </p>
            </div>

            <div className="relative mx-auto mt-14 max-w-3xl overflow-hidden border border-slate-200 bg-white">
              <CornerBrackets className="text-slate-300" />
              <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-100 text-sm font-semibold">
                <div className="px-5 py-3.5 text-slate-500">Doing it manually</div>
                <div className="px-5 py-3.5 text-indigo-700">With PayNudge</div>
              </div>
              {COMPARISON.map((row, i) => (
                <div
                  key={row.old}
                  className={cn('grid grid-cols-2 text-sm', i !== COMPARISON.length - 1 && 'border-b border-slate-100')}
                >
                  <div className="flex items-start gap-2.5 px-5 py-4 text-slate-500">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                    {row.old}
                  </div>
                  <div className="flex items-start gap-2.5 border-l border-slate-100 px-5 py-4">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    {row.new}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─────────── FEATURES ─────────── */}
        <section id="features" className="relative scroll-mt-20 py-20">
          <div className="container relative">
            <div aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-slate-200" />
            <div aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-slate-200" />
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-[0.3em] text-indigo-600">
              [ 06 ] · Features
            </p>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                More than just invoicing
              </h2>
              <p className="mt-4 text-slate-500">
                Everything you need from first invoice to final payment, in one clean dashboard.
              </p>
            </div>

            <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="relative border border-slate-200 p-6 transition-colors hover:bg-slate-50">
                  <CornerBrackets className="text-slate-300" />
                  <f.icon className="mb-4 h-6 w-6 text-indigo-600" />
                  <h3 className="mb-2 font-semibold">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-500">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─────────── SOCIAL PROOF ─────────── */}
        <section className="relative py-20">
          <div className="container relative">
            <div aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-slate-200" />
            <div aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-slate-200" />
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-[0.3em] text-indigo-600">
              [ 07 ] · Early access
            </p>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Be one of our first customers
              </h2>
              <p className="mt-4 text-slate-500">
                PayNudge just launched. Sign up now and help shape what we build next.
              </p>
            </div>

            <div className="relative mx-auto mt-12 flex max-w-lg flex-col items-center gap-4 border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
              <CornerBrackets className="text-slate-400" />
              <div className="flex gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-5 w-5 fill-slate-300 text-slate-300" />
                ))}
              </div>
              <p className="text-sm text-slate-500">
                No reviews yet — because we&apos;d rather earn real ones than fake them.
                <br />
                Try PayNudge and be our first story.
              </p>
              <BracketButton href="/signup" className="mt-2">
                Start free today
              </BracketButton>
            </div>
          </div>
        </section>

        {/* ─────────── FAQ ─────────── */}
        <section id="faq" className="relative scroll-mt-20 border-y border-slate-200 bg-slate-50 py-20">
          <div className="container relative">
            <div aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-slate-200" />
            <div aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-slate-200" />
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-[0.3em] text-indigo-600">
              [ 08 ] · FAQ
            </p>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Answers before you start</h2>
            </div>

            <div className="mx-auto mt-12 max-w-2xl">
              <Accordion type="single" collapsible className="w-full">
                {FAQS.map((faq, i) => (
                  <AccordionItem key={faq.q} value={`item-${i}`} className="border-slate-200">
                    <AccordionTrigger className="text-left text-sm font-semibold hover:no-underline">
                      {faq.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-sm leading-relaxed text-slate-500">
                      {faq.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </section>

        {/* ─────────── FINAL CTA ─────────── */}
        <section className="relative py-24">
          <div className="container relative flex flex-col items-center text-center">
            <div aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-slate-200" />
            <div aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-slate-200" />
            <div className="relative mb-6 flex h-14 w-14 items-center justify-center bg-indigo-600">
              <CornerBrackets className="text-indigo-300" />
              <Zap className="h-7 w-7 text-white" />
            </div>
            <h2 className="max-w-lg text-3xl font-bold tracking-tight sm:text-4xl">
              Your next overdue invoice could chase itself
            </h2>
            <p className="mt-4 max-w-md text-slate-500">
              Create your free account, send an invoice, and see what happens when it goes overdue. Takes 30 seconds.
            </p>
            <BracketButton href="/signup" className="mt-8 h-12 px-8">
              Start free — no card needed
            </BracketButton>
          </div>
        </section>
      </main>

      {/* ─────────── FOOTER ─────────── */}
      <footer className="border-t border-slate-200">
        {/* Purple transition banner */}
        <div className="relative h-6 bg-indigo-700">
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)',
              backgroundSize: '14px 14px',
            }}
          />
        </div>

        <div className="bg-slate-50">
          <div className="container grid gap-10 border-b border-slate-200 py-10 md:grid-cols-2">
            {/* Logo + description */}
            <div className="relative border border-slate-200 bg-white p-6">
              <CornerBrackets className="text-slate-300" />
              <Link href="/" className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600">
                  <Zap className="h-3.5 w-3.5 text-white" />
                </span>
                PayNudge
              </Link>
              <p className="mt-3 text-sm leading-relaxed text-slate-500">
                Build modern invoicing workflows with precision-crafted automation.
                Designed for freelancers who care about getting paid on time.
              </p>
            </div>

            {/* Newsletter */}
            <div className="relative border border-slate-200 bg-white p-6">
              <CornerBrackets className="text-slate-300" />
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-indigo-600">Newsletter</p>
              <h3 className="mt-2 text-lg font-bold">Stay in the loop</h3>
              <p className="mt-1 text-sm text-slate-500">
                Get product updates, invoicing tips, and early access delivered monthly.
              </p>
              <form className="mt-4 flex gap-2" onSubmit={(e) => e.preventDefault()}>
                <Input
                  type="email"
                  placeholder="you@company.com"
                  className="border-slate-300"
                  required
                />
                <Button type="submit" className="relative bg-indigo-600 px-5 text-xs font-bold uppercase tracking-widest hover:bg-indigo-700">
                  <CornerBrackets className="text-indigo-300" />
                  Subscribe
                </Button>
              </form>
            </div>
          </div>

          {/* Link columns */}
          <div className="container flex flex-wrap justify-between gap-8 py-10">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-900">Product</p>
              <ul className="mt-4 space-y-2.5 text-sm text-slate-500">
                <li><a href="#features" className="hover:text-slate-900">Features</a></li>
                <li><a href="#how-it-works" className="hover:text-slate-900">How it works</a></li>
                <li><a href="#faq" className="hover:text-slate-900">FAQ</a></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-900">Account</p>
              <ul className="mt-4 space-y-2.5 text-sm text-slate-500">
                <li><Link href="/signup" className="hover:text-slate-900">Sign up</Link></li>
                <li><Link href="/login" className="hover:text-slate-900">Log in</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-900">Legal</p>
              <ul className="mt-4 space-y-2.5 text-sm text-slate-500">
                <li><Link href="/" className="hover:text-slate-900">Privacy Policy</Link></li>
                <li><Link href="/" className="hover:text-slate-900">Terms of Service</Link></li>
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="container flex flex-col items-center justify-center gap-3 border-t border-slate-200 py-6 text-xs text-slate-500 sm:flex-row">
            <p>
              © {new Date().getFullYear()} PayNudge. All rights reserved.{' '}
              <span className="ml-2 inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                All systems operational
              </span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
