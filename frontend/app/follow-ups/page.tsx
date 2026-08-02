'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api/client';
import { Nav } from '@/components/nav';
import { Card, CardContent } from '@/components/ui/card';
import { FollowUpCard } from './follow-up-card';
import type { EscalationTier, PendingFollowUp, PendingFollowUpsResponse } from './types';

/**
 * Pending follow-up approval view (Req 9.2, 9.3, 9.5, 9.10).
 *
 * Lists every follow-up the user owns that is awaiting approval, most-recently
 * drafted first (the backend already orders by `drafted_at` desc — Req 9.2),
 * each with its invoice/client context and drafted content. Each item exposes
 * inline actions to edit (Req 9.3), approve and send (Req 9.5), or discard
 * (Req 9.10) via {@link FollowUpCard}.
 *
 * This is a client component because it reads data through the authenticated
 * browser API client (which attaches the Supabase session JWT). A failed load
 * surfaces the backend message; approve/discard remove the resolved item from
 * the list so the view always reflects the current pending set.
 */
export default function FollowUpsPage() {
  const [followUps, setFollowUps] = useState<PendingFollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiGet<PendingFollowUpsResponse>(
      '/follow-ups?status=pending_approval',
    );
    if (!result.ok) {
      setError(result.error);
      setFollowUps([]);
    } else {
      setFollowUps(result.data.follow_ups ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleResolved = useCallback((id: string) => {
    // Approved or discarded: it is no longer pending, so drop it from the list.
    setFollowUps((current) => current.filter((f) => f.id !== id));
  }, []);

  const handleEdited = useCallback((id: string, content: string, tier?: EscalationTier) => {
    setFollowUps((current) =>
      current.map((f) => (f.id === id ? { ...f, content, tier: tier ?? f.tier } : f)),
    );
  }, []);

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="container space-y-6 py-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Follow-ups awaiting approval</h1>
          <p className="text-sm text-muted-foreground">
            Review each AI-drafted follow-up. Nothing is emailed to a client until you approve it.
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading pending follow-ups…</p>
        ) : null}

        {!loading && !error && followUps.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-2xl">
                ✉️
              </div>
              <h2 className="text-lg font-semibold">Nothing to review right now</h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                When an invoice becomes overdue, the AI drafts a follow-up email here for your
                approval before anything is sent to the client.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <div className="space-y-4">
          {followUps.map((followUp) => (
            <FollowUpCard
              key={followUp.id}
              followUp={followUp}
              onResolved={handleResolved}
              onEdited={handleEdited}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
