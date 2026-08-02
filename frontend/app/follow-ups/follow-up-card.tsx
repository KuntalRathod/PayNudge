'use client';

import { useState } from 'react';
import { apiPost, apiPut, type ApiResult } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  formatAmount,
  formatDate,
  MAX_CONTENT_LENGTH,
  ordinalLabel,
  tierLabel,
  type EscalationTier,
  type FollowUpActionResponse,
  type PendingFollowUp,
} from './types';

/** Tones offered by the "Regenerate with different tone" action (Feature 3). */
const TONE_OPTIONS: ReadonlyArray<{ value: EscalationTier; label: string }> = [
  { value: 'polite', label: 'Polite' },
  { value: 'firm', label: 'Firm' },
  { value: 'final_notice', label: 'Final Notice' },
];

/**
 * A single pending follow-up (Req 9.2), with inline actions to edit its drafted
 * content (Req 9.3), regenerate it with a different tone (Feature 3), approve
 * and send it (Req 9.5), or discard it (Req 9.10).
 *
 * The card owns all per-item interaction state (edit mode, the draft textarea,
 * a busy flag, and the last action error) so one failing item never blocks the
 * others. Every backend call resolves to an {@link ApiResult}; a non-OK result
 * surfaces the backend message inline via `role="alert"`.
 *
 * On a successful approve or discard the follow-up leaves the pending list, so
 * the card calls {@link onResolved} to have the parent drop it. A successful
 * edit or regenerate keeps the item pending and reports the new content (and,
 * for regenerate, the new tier) via {@link onEdited}.
 */
export interface FollowUpCardProps {
  followUp: PendingFollowUp;
  /** Called after the item transitions out of pending (approved or discarded). */
  onResolved: (id: string, outcome: 'approved' | 'discarded') => void;
  /** Called after a successful content edit or tone regeneration. */
  onEdited: (id: string, content: string, tier?: EscalationTier) => void;
}

type BusyAction = 'approve' | 'discard' | 'save' | 'regenerate' | null;

export function FollowUpCard({ followUp, onResolved, onEdited }: FollowUpCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(followUp.content);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [toneMenuOpen, setToneMenuOpen] = useState(false);

  const invoice = followUp.invoice;
  const clientName = invoice?.client?.name ?? 'Unknown client';
  const disabled = busy !== null;

  const trimmedEmpty = draft.length === 0;
  const tooLong = draft.length > MAX_CONTENT_LENGTH;

  function reportError<T>(result: Extract<ApiResult<T>, { ok: false }>): void {
    setError(result.error);
  }

  function startEdit(): void {
    setDraft(followUp.content);
    setError(null);
    setEditing(true);
  }

  function cancelEdit(): void {
    setDraft(followUp.content);
    setError(null);
    setEditing(false);
  }

  async function saveEdit(): Promise<void> {
    // Client-side guard mirroring Req 9.3/9.4 so an invalid edit is not sent.
    if (trimmedEmpty || tooLong) {
      return;
    }
    setBusy('save');
    setError(null);
    const result = await apiPut<FollowUpActionResponse>(
      `/follow-ups/${followUp.id}/content`,
      { content: draft },
    );
    setBusy(null);
    if (!result.ok) {
      reportError(result);
      return;
    }
    onEdited(followUp.id, result.data.follow_up.content);
    setEditing(false);
  }

  async function regenerate(tone: EscalationTier): Promise<void> {
    setToneMenuOpen(false);
    setBusy('regenerate');
    setError(null);
    const result = await apiPost<FollowUpActionResponse>(
      `/follow-ups/${followUp.id}/regenerate`,
      { tone },
    );
    setBusy(null);
    if (!result.ok) {
      reportError(result);
      return;
    }
    const updated = result.data.follow_up;
    setDraft(updated.content);
    onEdited(followUp.id, updated.content, updated.tier);
  }

  async function approve(): Promise<void> {
    setBusy('approve');
    setError(null);
    const result = await apiPost<FollowUpActionResponse>(`/follow-ups/${followUp.id}/approve`);
    setBusy(null);
    if (!result.ok) {
      reportError(result);
      return;
    }
    onResolved(followUp.id, 'approved');
  }

  async function discard(): Promise<void> {
    setBusy('discard');
    setError(null);
    const result = await apiPost<FollowUpActionResponse>(`/follow-ups/${followUp.id}/discard`);
    setBusy(null);
    if (!result.ok) {
      reportError(result);
      return;
    }
    onResolved(followUp.id, 'discarded');
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="font-semibold">
            {clientName}
            {invoice ? (
              <span className="text-muted-foreground"> · Invoice #{invoice.invoice_number}</span>
            ) : null}
          </p>
          {invoice ? (
            <p className="text-sm text-muted-foreground">
              {formatAmount(invoice.amount)} · due {formatDate(invoice.due_date)}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {followUp.follow_up_number ? (
            <span className="inline-flex w-fit items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {ordinalLabel(followUp.follow_up_number)} follow-up
            </span>
          ) : null}
          <span className="inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-medium">
            {tierLabel(followUp.tier)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {editing ? (
          <div className="space-y-2">
            <label htmlFor={`content-${followUp.id}`} className="text-sm font-medium">
              Edit follow-up content
            </label>
            <Textarea
              id={`content-${followUp.id}`}
              className="min-h-40"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={disabled}
              aria-invalid={trimmedEmpty || tooLong}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {draft.length.toLocaleString()} / {MAX_CONTENT_LENGTH.toLocaleString()} characters
              </span>
              {trimmedEmpty ? (
                <span className="text-destructive">Content cannot be empty.</span>
              ) : null}
              {tooLong ? (
                <span className="text-destructive">
                  Content exceeds the {MAX_CONTENT_LENGTH.toLocaleString()} character limit.
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-foreground">{followUp.content}</p>
        )}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <Button
              onClick={saveEdit}
              disabled={disabled || trimmedEmpty || tooLong}
              size="sm"
            >
              {busy === 'save' ? 'Saving…' : 'Save changes'}
            </Button>
            <Button onClick={cancelEdit} disabled={disabled} variant="ghost" size="sm">
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button onClick={approve} disabled={disabled} size="sm">
              {busy === 'approve' ? 'Sending…' : 'Approve & send'}
            </Button>
            <Button onClick={startEdit} disabled={disabled} variant="outline" size="sm">
              Edit
            </Button>

            <div className="relative">
              <Button
                onClick={() => setToneMenuOpen((open) => !open)}
                disabled={disabled}
                variant="outline"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={toneMenuOpen}
              >
                {busy === 'regenerate' ? 'Regenerating…' : 'Regenerate with tone ▾'}
              </Button>
              {toneMenuOpen ? (
                <div
                  role="menu"
                  className="absolute left-0 top-full z-10 mt-1 w-40 rounded-md border bg-popover p-1 shadow-md"
                >
                  {TONE_OPTIONS.map((tone) => (
                    <button
                      key={tone.value}
                      type="button"
                      role="menuitem"
                      onClick={() => regenerate(tone.value)}
                      disabled={disabled}
                      className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                    >
                      {tone.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <Button onClick={discard} disabled={disabled} variant="destructive" size="sm">
              {busy === 'discard' ? 'Discarding…' : 'Discard'}
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
