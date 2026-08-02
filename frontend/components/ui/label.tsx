import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * shadcn/ui Label — a locally-vendored form label with consistent styling.
 * Reused by later UI tasks (15.2–15.5).
 */
export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
          className,
        )}
        {...props}
      />
    );
  },
);
Label.displayName = 'Label';

export { Label };
