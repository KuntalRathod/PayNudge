'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api/client';
import { Nav } from '@/components/nav';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { FollowUpCard } from './follow-up-card';
import { SentHistoryCard } from './sent-history-card';
import type { EscalationTier, PendingFollowUp, PendingFollowUpsResponse } from './types';

type Tab = 'pending' | 'sent';

interface ProfileResponse {
  profile: { business_name: string };
}

export default function FollowUpsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [followUps, setFollowUps] = useState<PendingFollowUp[]>([]);
  const [sentFollowUps, setSentFollowUps] = useState<PendingFollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [sentLoading, setSentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [senderName, setSenderName] = useState<string>('');

  // Load sender name from profile
  useEffect(() => {
    void (async () => {
      const result = await apiGet<ProfileResponse>('/settings/profile');
      if (result.ok) {
        setSenderName(result.data.profile.business_name || '');
      }
    })();
  }, []);

  const loadPending = useCallback(async () => {
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

  const loadSent = useCallback(async () => {
    setSentLoading(true);
    const result = await apiGet<PendingFollowUpsResponse>('/follow-ups?status=sent');
    if (result.ok) {
      setSentFollowUps(result.data.follow_ups ?? []);
    }
    setSentLoading(false);
  }, []);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  useEffect(() => {
    if (tab === 'sent' && sentFollowUps.length === 0 && !sentLoading) {
      void loadSent();
    }
  }, [tab, sentFollowUps.length, sentLoading, loadSent]);

  const handleResolved = useCallback((id: string) => {
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
          <h1 className="text-2xl font-bold tracking-tight">Follow-ups</h1>
          <p className="text-sm text-muted-foreground">
            Review AI-drafted follow-ups or view previously sent emails.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1" role="tablist" aria-label="Follow-up views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'pending'}
            onClick={() => setTab('pending')}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              tab === 'pending'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            Awaiting approval
            {followUps.length > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-foreground/20 px-1 text-xs">
                {followUps.length}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'sent'}
            onClick={() => setTab('sent')}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              tab === 'sent'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            Sent history
          </button>
        </div>

        {/* Error */}
        {error && tab === 'pending' ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}

        {/* Pending tab */}
        {tab === 'pending' && (
          <>
            {loading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Card key={index}>
                    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3.5 w-40" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-5 w-24 rounded-full" />
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <SkeletonText lines={3} />
                    </CardContent>
                    <CardFooter className="flex flex-wrap items-center gap-2">
                      <Skeleton className="h-8 w-28" />
                      <Skeleton className="h-8 w-16" />
                      <Skeleton className="h-8 w-40" />
                      <Skeleton className="h-8 w-20" />
                    </CardFooter>
                  </Card>
                ))}
              </div>
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
                  senderName={senderName}
                  onResolved={handleResolved}
                  onEdited={handleEdited}
                />
              ))}
            </div>
          </>
        )}

        {/* Sent history tab */}
        {tab === 'sent' && (
          <>
            {sentLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Card key={index}>
                    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3.5 w-40" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-5 w-16 rounded-full" />
                        <Skeleton className="h-5 w-12 rounded-full" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <SkeletonText lines={3} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : null}

            {!sentLoading && sentFollowUps.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-2xl">
                    📬
                  </div>
                  <h2 className="text-lg font-semibold">No sent follow-ups yet</h2>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Once you approve and send a follow-up, it will appear here for reference.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            <div className="space-y-4">
              {sentFollowUps.map((followUp) => (
                <SentHistoryCard key={followUp.id} followUp={followUp} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
