import { cn } from '@/lib/utils';

/**
 * Decorative L-shaped corner brackets, as seen framing buttons/cards in
 * technical/blueprint-style SaaS landing pages (e.g. Cypon Analytics). Purely
 * visual — absolutely positioned at each of the 4 corners of the nearest
 * `relative` ancestor.
 */
export function CornerBrackets({ className }: { className?: string }) {
  return (
    <span className={cn('pointer-events-none absolute inset-0', className)} aria-hidden="true">
      <span className="absolute -left-1 -top-1 h-2 w-2 border-l-2 border-t-2 border-current" />
      <span className="absolute -right-1 -top-1 h-2 w-2 border-r-2 border-t-2 border-current" />
      <span className="absolute -bottom-1 -left-1 h-2 w-2 border-b-2 border-l-2 border-current" />
      <span className="absolute -bottom-1 -right-1 h-2 w-2 border-b-2 border-r-2 border-current" />
    </span>
  );
}
