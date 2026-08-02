'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
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
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet, apiPost } from '@/lib/api/client';
import type {
  ClientListResponse,
  ClientOption,
  InvoiceResponse,
} from '../types';
import {
  MAX_DESCRIPTION_LENGTH,
  validateInvoiceForm,
  type InvoiceFormErrors,
} from './validate';

/**
 * Create-invoice form (Req 3.1).
 *
 * Lets the user pick an existing owned client (fetched via `GET /clients`,
 * satisfying Req 2.8), enter an amount (0.01–999,999,999.99, ≤2 decimals), a
 * description (1–2000 chars), and a due date, then submits `POST /invoices`.
 * Client-side validation gives immediate feedback; the backend remains the
 * source of truth and any error it returns is surfaced. On success the user is
 * routed to the new invoice's detail view.
 */
export function InvoiceForm() {
  const router = useRouter();

  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [clientsError, setClientsError] = useState<string | null>(null);

  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');

  const [fieldErrors, setFieldErrors] = useState<InvoiceFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await apiGet<ClientListResponse>('/clients');
      if (!active) return;
      if (!result.ok) {
        setClientsError(result.error);
        setClients([]);
        return;
      }
      setClients(result.data.clients ?? []);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const values = { clientId, amount, description, dueDate };
    const errors = validateInvoiceForm(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setSubmitting(true);
    const result = await apiPost<InvoiceResponse>('/invoices', {
      clientId,
      amount,
      description,
      dueDate,
    });

    if (!result.ok) {
      setFormError(result.error);
      setSubmitting(false);
      return;
    }

    router.push(`/invoices/${result.data.invoice.id}`);
    router.refresh();
  }

  const hasClients = clients !== null && clients.length > 0;

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>New invoice</CardTitle>
        <CardDescription>Bill an existing client for completed work.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clientId">Client</Label>
            {clients === null ? (
              <Skeleton className="h-10 w-full" />
            ) : hasClients ? (
              <select
                id="clientId"
                name="clientId"
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={submitting}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select a client…</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                    {client.company ? ` (${client.company})` : ''} — {client.email}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-muted-foreground">
                You have no clients yet.{' '}
                <Link
                  href="/clients/new"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Add a client
                </Link>{' '}
                before creating an invoice.
              </p>
            )}
            {clientsError ? (
              <p role="alert" className="text-sm text-destructive">
                {clientsError}
              </p>
            ) : null}
            {fieldErrors.clientId ? (
              <p role="alert" className="text-sm text-destructive">
                {fieldErrors.clientId}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount (USD)</Label>
            <Input
              id="amount"
              name="amount"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={submitting}
            />
            {fieldErrors.amount ? (
              <p role="alert" className="text-sm text-destructive">
                {fieldErrors.amount}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description of work</Label>
            <textarea
              id="description"
              name="description"
              required
              rows={4}
              maxLength={MAX_DESCRIPTION_LENGTH}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {fieldErrors.description ? (
              <p role="alert" className="text-sm text-destructive">
                {fieldErrors.description}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="dueDate">Due date</Label>
            <Input
              id="dueDate"
              name="dueDate"
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={submitting}
            />
            {fieldErrors.dueDate ? (
              <p role="alert" className="text-sm text-destructive">
                {fieldErrors.dueDate}
              </p>
            ) : null}
          </div>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex items-center justify-end gap-3">
          <Link href="/invoices" className={buttonVariants({ variant: 'outline' })}>
            Cancel
          </Link>
          <Button type="submit" disabled={submitting || !hasClients}>
            {submitting ? 'Creating…' : 'Create invoice'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
