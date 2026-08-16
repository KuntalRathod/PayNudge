import { cn } from '@/lib/utils';

/**
 * Repeating diagonal-stripe "hatch" texture used as a decorative side margin
 * in technical/blueprint-style SaaS landing pages (e.g. Cypon Analytics). Pure
 * CSS via a repeating-linear-gradient background — no image asset needed.
 */
export function HatchPattern({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none', className)}
      style={{
        backgroundImage:
          'repeating-linear-gradient(135deg, hsl(var(--border)) 0, hsl(var(--border)) 1px, transparent 1px, transparent 8px)',
      }}
    />
  );
}
