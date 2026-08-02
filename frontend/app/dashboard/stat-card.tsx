import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A single dashboard summary metric (feature-local, Task 15.4).
 *
 * Renders one headline figure with a label and optional supporting hint — used
 * for the Outstanding_Total (Req 5.1), overdue count (Req 5.3),
 * pending-follow-up count (Req 5.4), and the additional metrics added in the
 * Dashboard upgrade (Overdue Amount, Collected This Month, Average Days to
 * Pay). Kept presentational so the values (and their zero/empty states) are
 * decided by the parent view.
 *
 * `tone` lets a metric's headline figure pick up a semantic color (e.g. red
 * for an overdue amount, green for money collected) while keeping the same
 * card shape/spacing as the rest of the grid.
 */
export interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'danger' | 'success';
}

const TONE_CLASSES: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: '',
  danger: 'text-red-600 dark:text-red-400',
  success: 'text-green-600 dark:text-green-400',
};

export function StatCard({ label, value, hint, tone = 'default' }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn('text-3xl tabular-nums', TONE_CLASSES[tone])}>{value}</CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">{hint}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}
