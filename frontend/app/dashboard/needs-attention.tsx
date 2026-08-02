import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * "Needs your attention" section (Dashboard upgrade): surfaces the two things
 * most likely to need action right now — overdue invoices and follow-ups
 * awaiting approval — each with a one-click way to act. Rendered with a soft
 * tinted background/border so it stands out slightly from the plain stat
 * cards above it, without breaking the app's clean/minimal card language.
 */
export interface NeedsAttentionProps {
  overdueCount: number;
  pendingFollowUpCount: number;
}

export function NeedsAttention({ overdueCount, pendingFollowUpCount }: NeedsAttentionProps) {
  if (overdueCount === 0 && pendingFollowUpCount === 0) {
    return null;
  }

  return (
    <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="text-lg">Needs your attention</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div
          className={cn(
            'flex items-center justify-between gap-4 rounded-lg border bg-background p-4',
            overdueCount === 0 && 'opacity-60',
          )}
        >
          <div>
            <p className="text-2xl font-semibold tabular-nums">{overdueCount}</p>
            <p className="text-sm text-muted-foreground">
              overdue invoice{overdueCount === 1 ? '' : 's'}
            </p>
          </div>
          <Link
            href="/invoices?status=overdue"
            className={buttonVariants({ variant: overdueCount > 0 ? 'default' : 'outline', size: 'sm' })}
          >
            View
          </Link>
        </div>

        <div
          className={cn(
            'flex items-center justify-between gap-4 rounded-lg border bg-background p-4',
            pendingFollowUpCount === 0 && 'opacity-60',
          )}
        >
          <div>
            <p className="text-2xl font-semibold tabular-nums">{pendingFollowUpCount}</p>
            <p className="text-sm text-muted-foreground">
              follow-up{pendingFollowUpCount === 1 ? '' : 's'} pending review
            </p>
          </div>
          <Link
            href="/follow-ups"
            className={buttonVariants({
              variant: pendingFollowUpCount > 0 ? 'default' : 'outline',
              size: 'sm',
            })}
          >
            Review
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
