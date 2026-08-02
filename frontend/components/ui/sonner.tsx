'use client';

import { Toaster as SonnerToaster } from 'sonner';

/**
 * App-wide toast container using Sonner.
 *
 * Renders at the bottom-right on desktop and bottom-center on mobile.
 * Styled to match the shadcn design tokens via the `richColors` prop
 * and custom class names.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      toastOptions={{
        classNames: {
          toast: 'font-sans',
        },
      }}
    />
  );
}
