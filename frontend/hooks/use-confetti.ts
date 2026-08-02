import { useCallback } from 'react';
import confetti from 'canvas-confetti';

/**
 * Fires a premium-feeling confetti burst using brand-friendly colors.
 *
 * The animation runs for ~2 seconds, doesn't block the UI, and auto-cleans
 * the canvas element when finished. Works on desktop and mobile.
 */
export function useConfetti() {
  const fire = useCallback(() => {
    const duration = 2000;
    const end = Date.now() + duration;

    const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];

    function frame() {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors,
        ticks: 200,
        gravity: 1.2,
        scalar: 1.1,
        drift: 0,
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors,
        ticks: 200,
        gravity: 1.2,
        scalar: 1.1,
        drift: 0,
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    }

    frame();
  }, []);

  return fire;
}
