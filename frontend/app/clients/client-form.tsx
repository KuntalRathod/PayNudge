'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiPost, apiPut } from '@/lib/api/client';
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
import {
  COMPANY_MAX_LENGTH,
  NAME_MAX_LENGTH,
  fieldFromMessage,
  type Client,
  type ClientField,
  type ClientPayload,
  type ClientResponse,
} from './types';

/**
 * Shared create/edit client form (Req 2.1, 2.9).
 *
 * A single controlled form serves both flows because the backend applies the
 * same validation to create and update:
 *   - `mode="create"` → `POST /clients` (Req 2.1).
 *   - `mode="edit"`   → `PUT /clients/:id`, prefilled from `initialClient`
 *     (Req 2.9).
 *
 * On a 400 the backend returns `{ error, field, code }`; the shared API client
 * surfaces only the `error` string, so we best-effort map that message back to
 * the offending field ({@link fieldFromMessage}) to highlight the right input,
 * and always show the full message so no server feedback is lost. On success we
 * navigate back to the client list and refresh server state.
 */
type ClientFormProps =
  | { mode: 'create'; initialClient?: undefined }
  | { mode: 'edit'; initialClient: Client };

export function ClientForm(props: ClientFormProps) {
  const { mode } = props;
  const router = useRouter();

  const [name, setName] = useState(props.initialClient?.name ?? '');
  const [email, setEmail] = useState(props.initialClient?.email ?? '');
  const [company, setCompany] = useState(props.initialClient?.company ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<ClientField | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setInvalidField(null);
    setSubmitting(true);

    const trimmedCompany = company.trim();
    const payload: ClientPayload = {
      name: name.trim(),
      email: email.trim(),
      company: trimmedCompany.length > 0 ? trimmedCompany : null,
    };

    const result =
      mode === 'create'
        ? await apiPost<ClientResponse>('/clients', payload)
        : await apiPut<ClientResponse>(`/clients/${props.initialClient.id}`, payload);

    if (!result.ok) {
      setFormError(result.error);
      // A 400 is a field validation failure (Req 2.1); highlight the field.
      if (result.status === 400) {
        setInvalidField(fieldFromMessage(result.error));
      }
      setSubmitting(false);
      return;
    }

    // Editing returns to the Client Detail page so the save is immediately
    // visible in context; creating returns to the list (Clients section
    // upgrade).
    router.push(mode === 'edit' ? `/clients/${props.initialClient.id}` : '/clients');
    router.refresh();
  }

  const title = mode === 'create' ? 'New client' : 'Edit client';
  const description =
    mode === 'create'
      ? 'Save a client so you can reuse their details when billing.'
      : 'Update this client’s details.';
  const submitLabel = mode === 'create' ? 'Create client' : 'Save changes';
  const submittingLabel = mode === 'create' ? 'Creating…' : 'Saving…';

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              maxLength={NAME_MAX_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              aria-invalid={invalidField === 'name'}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              aria-invalid={invalidField === 'email'}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company">Company (optional)</Label>
            <Input
              id="company"
              name="company"
              maxLength={COMPANY_MAX_LENGTH}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              disabled={submitting}
              aria-invalid={invalidField === 'company'}
            />
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex items-center justify-end gap-3">
          <Link
            href={mode === 'edit' ? `/clients/${props.initialClient.id}` : '/clients'}
            className={buttonVariants({ variant: 'outline' })}
          >
            Cancel
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? submittingLabel : submitLabel}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
