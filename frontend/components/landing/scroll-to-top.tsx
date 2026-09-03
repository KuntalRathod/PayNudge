'use client';

import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { CornerBrackets } from '@/components/landing/corner-brackets';
import { cn } from '@/lib/utils';

/**
 * A floating "back to top" button for the landing page.
 *
 * Appears once the user has scrolled past a threshold and smoothly returns them
 * to the top of the page when clicked. Purely client-side (needs the scroll
 * position), so it lives in its own `'use client'` component and is dropped into
 * the otherwise server-rendered landing page.
 *
 * Styling mirrors the landing page's signature look: indigo solid fill with the
 * decorative L-bracket corners used elsewhere on the page.
 */
export function ScrollToTop({ threshold = 400 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > threshold);
    };

    // Set the initial state in case the page loads already scrolled.
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  function scrollToTop() {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  }

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Back to top"
      tabIndex={visible ? 0 : -1}
      className={cn(
        'fixed bottom-6 right-6 z-50 flex h-11 w-11 items-center justify-center',
        'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 transition-all duration-300',
        'hover:-translate-y-0.5 hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      )}
    >
      <CornerBrackets className="text-indigo-300" />
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
