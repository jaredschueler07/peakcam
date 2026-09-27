// ─────────────────────────────────────────────────────────────
// Entrance-fade props for `motion.*` elements (resort cards, cam tiles).
//
// INVARIANT: whenever `initial` hides the element (opacity 0), `whileInView`
// MUST be defined and MUST restore opacity 1 — in *every* reduced-motion state.
//
// Why this is a pure function with a test instead of inline JSX: motion's
// `useReducedMotion()` is `null`/false during SSR and the first client render
// and only flips to `true` after hydration. A component that derived
// `entrance = animate && !reducedMotion` therefore mounted with the hidden
// `initial` styles applied inline, then — once the hook flipped — dropped
// `whileInView`, and nothing ever animated the inline `opacity: 0` away. Every
// above-the-fold resort card on the homepage was invisible for users with
// "Reduce Motion" enabled (all engines). Reduced motion must change the
// *transition* (instant), never whether the reveal target exists.
// ─────────────────────────────────────────────────────────────

export interface EntranceMotionProps {
  initial: { opacity: number; y: number } | false;
  whileInView: { opacity: number; y: number } | undefined;
  viewport: { once: true };
  transition: { duration: number };
}

const HIDDEN = { opacity: 0, y: 20 } as const;
const SHOWN = { opacity: 1, y: 0 } as const;

/**
 * @param animate      Whether this element should get the entrance fade at
 *                     all (callers turn it off for below-the-fold items).
 * @param reducedMotion `useReducedMotion()` result — `null` before hydration.
 * @param duration     Seconds for the normal (non-reduced) reveal.
 */
export function entranceMotionProps(
  animate: boolean,
  reducedMotion: boolean | null,
  duration = 0.15,
): EntranceMotionProps {
  return {
    initial: animate ? { ...HIDDEN } : false,
    whileInView: animate ? { ...SHOWN } : undefined,
    viewport: { once: true },
    transition: { duration: reducedMotion ? 0 : duration },
  };
}
