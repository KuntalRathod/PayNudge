'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiPost, type ApiResult } from '@/lib/api/client';
import type { InvoiceResponse } from '../types';

const MAX_NOTE_LENGTH = 2000;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "Mark as Paid" modal (Feature 4): asks for a payment date and an optional
 * note before transitioning the invoice to "paid" via `POST /invoices/:id/pay`.
 * On success the event (with the date/note) is logged to the invoice's
 * activity timeline server-side.
 */
export function MarkPaidDialog({
  invoiceId,
  open,
  onOpenChange,
  onPaid,
}: {
  invoiceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaid: (result: ApiResult<InvoiceResponse>) => void;
}) {
  const [paymentDate, setPaymentDate] = useState(todayIsoDate);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSaving(true);
    setError(null);
    const result = await apiPost<InvoiceResponse>(`/invoices/${invoiceId}/pay`, {
      paymentDate,
      note: note.trim().length > 0 ? note.trim() : undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onPaid(result);
    onOpenChange(false);
    setNote('');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark invoice as paid</DialogTitle>
          <DialogDescription>
            Record when payment was received. This will stop any further AI follow-ups for
            this invoice.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="payment-date">Payment date</Label>
            <Input
              id="payment-date"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              disabled={saving}
              max={todayIsoDate()}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment-note">Note (optional)</Label>
            <Textarea
              id="payment-note"
              placeholder="e.g. Paid via bank transfer"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={saving}
              maxLength={MAX_NOTE_LENGTH}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {note.length.toLocaleString()} / {MAX_NOTE_LENGTH.toLocaleString()} characters
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={saving || !paymentDate}>
            {saving ? 'Saving…' : 'Mark as paid'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
