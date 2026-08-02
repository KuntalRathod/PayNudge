'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatCard, SkeletonListItem } from '@/components/ui/skeleton-card';
import { apiGet } from '@/lib/api/client';
import { ActivityFeed } from './activity-feed';
import { NeedsAttention } from './needs-attention';
import { OnboardingChecklist } from './onboarding-checklist';
import { StatCard } from './stat-card';
import { formatAverageDays, formatCurrency } from './format';
import type { DashboardSummary } from './types';

/**
 * Dashboard data view (client component, Task 15.4).
 *
 * Fetches the per-user summary from `GET /dashboard` (authenticated via the
 * shared API client's Supabase-session token) and renders:
 *   - the Outstanding_Total as currency (Req 5.1),
 *   - the overdue-invoice count (Req 5.3),
 *   - the pending-follow-up count (Req 5.4), and
 *   - the Activity_Feed of up to 20 recent events, most-recent-first (Req 5.5).
 *
 * Zero totals/counts and an empty feed render as explicit zero/empty states
 * (Req 5.2, 5.6). Loading and error states are surfaced so a failed fetch
 * never leaves a blank screen; the user can retry.
 */
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DashboardSummary };

export function DashboardView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // Bumped by the retry button to re-run the fetch effect on demand.
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      const result = await apiGet<DashboardSummary>('/dashboard');
      if (!active) {
        return;
      }
      if (result.ok) {
        setState({ status: 'ready', data: result.data });
      } else {
        setState({ status: 'error', message: result.error });
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [reloadCounter]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setReloadCounter((count) => count + 1);
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <SkeletonStatCard key={index} />
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-44" />
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center justify-between gap-4 rounded-lg border bg-background p-4"
              >
                <div className="space-y-2">
                  <Skeleton className="h-7 w-10" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <Skeleton className="h-9 w-16" />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardContent className="divide-y">
            {Array.from({ length: 5 }).map((_, index) => (
              <SkeletonListItem key={index} />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  const { data } = state;

  return (
    <div className="space-y-6">
      <OnboardingChecklist />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Outstanding total"
          value={formatCurrency(data.outstanding_total)}
          hint="Sent and overdue invoices"
        />
        <StatCard
          label="Overdue invoices"
          value={String(data.overdue_count)}
          hint="Past their due date"
          tone={data.overdue_count > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Pending follow-ups"
          value={String(data.pending_follow_up_count)}
          hint="Awaiting your approval"
        />
        <StatCard
          label="Overdue amount"
          value={formatCurrency(data.overdue_amount)}
          hint="Money past its due date"
          tone={data.overdue_amount > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Collected this month"
          value={formatCurrency(data.collected_this_month)}
          hint="Invoices marked paid this month"
          tone="success"
        />
        <StatCard
          label="Avg. days to get paid"
          value={formatAverageDays(data.average_days_to_pay)}
          hint="From sent to paid"
        />
      </div>

      <NeedsAttention
        overdueCount={data.overdue_count}
        pendingFollowUpCount={data.pending_follow_up_count}
      />

      <ActivityFeed events={data.activity_events} />
    </div>
  );
}
