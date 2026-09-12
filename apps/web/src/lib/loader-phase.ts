/**
 * The loader's life, as a function of how long it has been running.
 *
 * It has three states, and the third one matters: a layer that has only been
 * made transparent is still in the tree, still composited, and still sitting
 * over the whole page at the top of the stacking order. It has to actually
 * leave.
 */

export const COUNT_MS = 1600;
export const FADE_MS = 600;

export type LoaderPhase = "counting" | "fading" | "gone";

export function loaderPhase(elapsed: number): LoaderPhase {
  if (elapsed < COUNT_MS) return "counting";
  if (elapsed < COUNT_MS + FADE_MS) return "fading";
  return "gone";
}

/** The count, eased so it decelerates into place rather than stopping dead. */
export function loaderProgress(elapsed: number): number {
  const t = Math.min(1, Math.max(0, elapsed / COUNT_MS));
  return 1 - Math.pow(1 - t, 3);
}
