'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Step {
  label: string;
  href: string;
  done: boolean;
}

/**
 * Light onboarding checklist (Feature 5): shown on the dashboard for
 * first-run accounts that have no clients or invoices yet. Walks through the
 * three steps needed to get value from the product: add a client, create an
 * invoice, and let the AI start chasing overdue ones.
 *
 * Fetches its own lightweight counts so it works standalone regardless of
 * what the dashboard summary includes, and hides itself once the user has at
 * least one client and one invoice (it has served its purpose).
 */
export function OnboardingChecklist() {
  const [clientCount, setClientCount] = useState<number | null>(null);
  const [invoiceCount, setInvoiceCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [clientsResult, invoicesResult] = await Promise.all([
        apiGet<{ clients: unknown[] }>('/clients'),
        apiGet<{ invoices: unknown[] }>('/invoices'),
      ]);
      if (!active) return;
      setClientCount(clientsResult.ok ? clientsResult.data.clients.length : 0);
      setInvoiceCount(invoicesResult.ok ? invoicesResult.data.invoices.length : 0);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (clientCount === null || invoiceCount === null) {
    return null;
  }

  const hasClient = clientCount > 0;
  const hasInvoice = invoiceCount > 0;

  // Once both a client and an invoice exist, the checklist has done its job.
  if (hasClient && hasInvoice) {
    return null;
  }

  const steps: Step[] = [
    { label: 'Add a client', href: '/clients/new', done: hasClient },
    { label: 'Create your first invoice', href: '/invoices/new', done: hasInvoice },
    { label: 'Let the AI chase overdue ones', href: '/follow-ups', done: false },
  ];

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-3 py-5">
        <h2 className="text-sm font-semibold">Get started in 3 steps</h2>
        <ol className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          {steps.map((step, index) => (
            <li key={step.label} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  step.done
                    ? 'bg-green-600 text-white'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {step.done ? '✓' : index + 1}
              </span>
              {step.done ? (
                <span className="text-sm text-muted-foreground line-through">{step.label}</span>
              ) : (
                <Link
                  href={step.href}
                  className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'h-auto p-0')}
                >
                  {step.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
