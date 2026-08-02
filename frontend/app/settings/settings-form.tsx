'use client';

import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPut } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { Profile, ProfileResponse } from './types';

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB, mirrors the backend limit.
const ACCEPTED_LOGO_TYPES = 'image/png,image/jpeg,image/webp,image/svg+xml';

/**
 * Expanded Settings form (Feature 2: Improved Company/Profile Settings).
 *
 * Reads/writes the user's profile via `GET/PUT /settings/profile`: business
 * name, logo (uploaded separately via `POST /settings/profile/logo`), business
 * address, payment instructions, default payment terms, email signature, and
 * a per-tier follow-up cadence (days overdue before each escalation tier).
 * These values automatically flow into generated invoice PDFs/emails and AI
 * follow-up emails (see backend `lib/invoicePdf.ts`, `ai/geminiDraft.ts`).
 */
export function SettingsForm() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({
    business_name: '',
    business_address: '',
    payment_instructions: '',
    default_payment_terms: '',
    email_signature: '',
    cadence_polite_days: '1',
    cadence_firm_days: '7',
    cadence_final_notice_days: '14',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadProfile() {
      const result = await apiGet<ProfileResponse>('/settings/profile');
      if (result.ok) {
        applyProfile(result.data.profile);
      } else {
        setError(result.error);
      }
      setLoading(false);
    }
    void loadProfile();
  }, []);

  function applyProfile(p: Profile) {
    setProfile(p);
    setForm({
      business_name: p.business_name,
      business_address: p.business_address ?? '',
      payment_instructions: p.payment_instructions ?? '',
      default_payment_terms: p.default_payment_terms ?? '',
      email_signature: p.email_signature ?? '',
      cadence_polite_days: String(p.cadence_polite_days),
      cadence_firm_days: String(p.cadence_firm_days),
      cadence_final_notice_days: String(p.cadence_final_notice_days),
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    const result = await apiPut<ProfileResponse>('/settings/profile', {
      business_name: form.business_name,
      business_address: form.business_address,
      payment_instructions: form.payment_instructions,
      default_payment_terms: form.default_payment_terms,
      email_signature: form.email_signature,
      cadence_polite_days: Number(form.cadence_polite_days),
      cadence_firm_days: Number(form.cadence_firm_days),
      cadence_final_notice_days: Number(form.cadence_final_notice_days),
    });

    if (result.ok) {
      applyProfile(result.data.profile);
      setSuccess('Settings updated successfully.');
    } else {
      setError(result.error);
    }
    setSaving(false);
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setSuccess(null);

    if (file.size > MAX_LOGO_BYTES) {
      setError(`Logo must be at most ${MAX_LOGO_BYTES / (1024 * 1024)}MB.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploadingLogo(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const result = await apiPost<ProfileResponse>('/settings/profile/logo', { dataUrl });
      if (result.ok) {
        applyProfile(result.data.profile);
        setSuccess('Logo updated.');
      } else {
        setError(result.error);
      }
    } catch {
      setError('Could not read the selected file. Please try again.');
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl space-y-6">
        <Card>
          <CardHeader className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-md" />
            <Skeleton className="h-8 w-48" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </CardContent>

          <CardHeader className="space-y-2 pt-0">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-80" />
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </CardContent>

          <CardFooter>
            <Skeleton className="h-9 w-32" />
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Company logo</CardTitle>
          <CardDescription>
            Appears on generated invoice PDFs. PNG, JPEG, WEBP, or SVG, up to 2MB.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-muted">
            {profile?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.logo_url}
                alt="Company logo"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-xs text-muted-foreground">No logo</span>
            )}
          </div>
          <div className="space-y-1">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_LOGO_TYPES}
              onChange={handleLogoChange}
              disabled={uploadingLogo}
              className="text-sm"
            />
            {uploadingLogo ? (
              <p className="text-xs text-muted-foreground">Uploading…</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <form onSubmit={handleSubmit} noValidate>
          <CardHeader>
            <CardTitle>Business profile</CardTitle>
            <CardDescription>
              These details appear on generated invoices and in AI follow-up emails.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="business_name">Business / Sender Name</Label>
              <Input
                id="business_name"
                name="business_name"
                type="text"
                required
                maxLength={200}
                value={form.business_name}
                onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))}
                disabled={saving}
                placeholder="e.g. Jane Smith or Smith Design Co."
              />
              <p className="text-xs text-muted-foreground">
                Appears in the sign-off of AI-generated follow-up emails and on invoices.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="business_address">Business Address</Label>
              <Textarea
                id="business_address"
                rows={3}
                maxLength={2000}
                value={form.business_address}
                onChange={(e) => setForm((f) => ({ ...f, business_address: e.target.value }))}
                disabled={saving}
                placeholder="123 Main St, Suite 100, San Francisco, CA 94107"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="default_payment_terms">Default Payment Terms</Label>
              <Input
                id="default_payment_terms"
                type="text"
                maxLength={100}
                value={form.default_payment_terms}
                onChange={(e) =>
                  setForm((f) => ({ ...f, default_payment_terms: e.target.value }))
                }
                disabled={saving}
                placeholder="e.g. Net 15, Due on receipt"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="payment_instructions">Payment Instructions</Label>
              <Textarea
                id="payment_instructions"
                rows={4}
                maxLength={4000}
                value={form.payment_instructions}
                onChange={(e) =>
                  setForm((f) => ({ ...f, payment_instructions: e.target.value }))
                }
                disabled={saving}
                placeholder="Bank details, UPI ID, or a Stripe payment link…"
              />
              <p className="text-xs text-muted-foreground">
                Shown at the bottom of every generated invoice PDF.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email_signature">Email Signature</Label>
              <Textarea
                id="email_signature"
                rows={3}
                maxLength={2000}
                value={form.email_signature}
                onChange={(e) => setForm((f) => ({ ...f, email_signature: e.target.value }))}
                disabled={saving}
                placeholder="Optional extra sign-off lines, e.g. your title or phone number"
              />
            </div>
          </CardContent>

          <CardHeader className="pt-0">
            <CardTitle className="text-lg">Follow-up cadence</CardTitle>
            <CardDescription>
              Days overdue before each escalation tier kicks in. Must strictly increase.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="cadence_polite_days">Polite (days)</Label>
              <Input
                id="cadence_polite_days"
                type="number"
                min={1}
                value={form.cadence_polite_days}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cadence_polite_days: e.target.value }))
                }
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cadence_firm_days">Firm (days)</Label>
              <Input
                id="cadence_firm_days"
                type="number"
                min={1}
                value={form.cadence_firm_days}
                onChange={(e) => setForm((f) => ({ ...f, cadence_firm_days: e.target.value }))}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cadence_final_notice_days">Final notice (days)</Label>
              <Input
                id="cadence_final_notice_days"
                type="number"
                min={1}
                value={form.cadence_final_notice_days}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cadence_final_notice_days: e.target.value }))
                }
                disabled={saving}
              />
            </div>
          </CardContent>

          <CardContent className="space-y-2 pt-0">
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {success ? (
              <p role="status" className="text-sm text-green-600">
                {success}
              </p>
            ) : null}
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
