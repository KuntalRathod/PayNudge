import { cn } from '@/lib/utils';

/**
 * Base loading-skeleton primitive.
 *
 * A single pulsing placeholder block. Deliberately unopinionated about size —
 * callers control width/height via `className` (e.g. `h-4 w-24`) so this stays
 * reusable across every shape a skeleton needs (text lines, avatars, buttons,
 * table cells, etc.) without the component hardcoding magic dimensions.
 *
 * Uses the same `bg-muted` / `rounded-md` tokens as the rest of the design
 * system so skeletons visually match real content, plus Tailwind's built-in
 * `animate-pulse` for a subtle, premium loading feel.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export interface SkeletonTextProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of placeholder text lines to render. Defaults to 1. */
  lines?: number;
  /** Extra classes applied to every line (e.g. to change height). */
  lineClassName?: string;
  /**
   * Width class applied to the last line when there is more than one line,
   * so paragraphs taper off the way real wrapped text does. Defaults to
   * `w-2/3`; pass `'w-full'` to disable the taper.
   */
  lastLineWidth?: string;
}

/**
 * A block of placeholder text lines.
 *
 * Renders `lines` pulsing bars; when there's more than one line, the last one
 * is narrower by default so it reads like a paragraph rather than a stack of
 * identical bars. Composable with any container spacing via `className`.
 */
export function SkeletonText({
  lines = 1,
  lineClassName,
  lastLineWidth = 'w-2/3',
  className,
  ...props
}: SkeletonTextProps) {
  return (
    <div className={cn('space-y-2', className)} {...props}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className={cn(
            'h-4 w-full',
            index === lines - 1 && lines > 1 && lastLineWidth,
            lineClassName,
          )}
        />
      ))}
    </div>
  );
}
