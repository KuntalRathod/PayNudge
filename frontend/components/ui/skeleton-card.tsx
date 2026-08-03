import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Skeleton, SkeletonText } from './skeleton';

/**
 * Composable skeleton building blocks for card/table/list layouts.
 *
 * These wrap the real {@link Card} primitives (same border, radius, shadow,
 * and padding as actual content) so a skeleton screen sits pixel-for-pixel
 * where the real card will render — no separate "skeleton card" styling to
 * keep in sync with the design system. Each component accepts `className`
 * so pages can nudge spacing without forking the component.
 */

export interface SkeletonCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Show a title-sized bar in the header. Defaults to true. */
  header?: boolean;
  /** Number of body text lines to render. Defaults to 2. */
  lines?: number;
  /** Extra content rendered below the body lines (e.g. skeleton buttons). */
  footer?: React.ReactNode;
}

/**
 * Generic card-shaped placeholder: header title bar + N body lines.
 * Use for any card whose real content is primarily text (forms, detail
 * panels, empty-ish sections) rather than a table or stat.
 */
export function SkeletonCard({
  header = true,
  lines = 2,
  footer,
  className,
  ...props
}: SkeletonCardProps) {
  return (
    <Card className={className} {...props}>
      {header ? (
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-1/3" />
        </CardHeader>
      ) : null}
      <CardContent className={cn(!header && 'pt-6', 'space-y-4')}>
        <SkeletonText lines={lines} />
        {footer}
      </CardContent>
    </Card>
  );
}

/**
 * Placeholder matching the dashboard/client-detail {@link StatCard}: a small
 * label line, a large headline-figure bar, and an optional hint line.
 */
export function SkeletonStatCard({
  hint = true,
  className,
}: {
  /** Whether to reserve space for the hint line beneath the figure. */
  hint?: boolean;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-8 w-20" />
      </CardHeader>
      {hint ? (
        <CardContent className="pt-0">
          <Skeleton className="h-4 w-32" />
        </CardContent>
      ) : null}
    </Card>
  );
}

export interface SkeletonTableRowProps {
  /** Number of columns to render. Should match the real table's column count. */
  columns?: number;
  /** Per-column width classes, keyed by index. Falls back to alternating widths. */
  columnWidths?: string[];
}

/** Fallback widths so columns vary in size without callers specifying every one. */
const DEFAULT_COLUMN_WIDTHS = ['w-24', 'w-40', 'w-20', 'w-24', 'w-16'];

/**
 * A single `<tr>` of pulsing cells, sized/padded like the app's real data
 * tables (`px-4 py-3` cells, bottom border). Meant to be rendered inside
 * {@link SkeletonTable}, but exported separately so a page with a
 * non-standard table shape can still reuse the row primitive.
 */
export function SkeletonTableRow({ columns = 4, columnWidths }: SkeletonTableRowProps) {
  return (
    <tr className="border-b last:border-0">
      {Array.from({ length: columns }).map((_, index) => (
        <td key={index} className="px-4 py-3">
          <Skeleton
            className={cn('h-4', columnWidths?.[index] ?? DEFAULT_COLUMN_WIDTHS[index % DEFAULT_COLUMN_WIDTHS.length])}
          />
        </td>
      ))}
    </tr>
  );
}

export interface SkeletonTableProps {
  /** Number of placeholder header/column groups. */
  columns?: number;
  /** Number of placeholder rows. Defaults to 5. */
  rows?: number;
  /** Optional column header labels; when omitted, header cells are skeletons too. */
  columnWidths?: string[];
  className?: string;
}

/**
 * A full table placeholder — header row + N body rows — wrapped in the same
 * `Card`/`CardContent` shell the real invoice/client tables use
 * (`<Card><CardContent className="p-0"><table>…`). Column count and widths
 * are configurable so this stays accurate as real tables gain/lose columns.
 */
export function SkeletonTable({ columns = 4, rows = 5, columnWidths, className }: SkeletonTableProps) {
  return (
    <Card className={className}>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              {Array.from({ length: columns }).map((_, index) => (
                <th key={index} className="px-4 py-3 text-left">
                  <Skeleton className="h-3.5 w-16" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, index) => (
              <SkeletonTableRow key={index} columns={columns} columnWidths={columnWidths} />
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export interface SkeletonListItemProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render a circular avatar/icon placeholder before the text. Defaults to false. */
  avatar?: boolean;
  /** Render a trailing action-shaped bar (button/badge/timestamp). Defaults to true. */
  trailing?: boolean;
}

/**
 * A single row placeholder for list-style content (activity feed rows,
 * follow-up cards' compact bits, timeline entries). Mirrors the
 * `flex items-center justify-between gap-4` row pattern used across the app.
 */
export function SkeletonListItem({
  avatar = false,
  trailing = true,
  className,
  ...props
}: SkeletonListItemProps) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-3', className)} {...props}>
      <div className="flex min-w-0 items-center gap-3">
        {avatar ? <Skeleton className="h-9 w-9 shrink-0 rounded-full" /> : null}
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3.5 w-56" />
        </div>
      </div>
      {trailing ? <Skeleton className="h-4 w-16 shrink-0" /> : null}
    </div>
  );
}
