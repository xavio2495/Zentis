/**
 * Where the install line currently sits, in CSS pixels.
 *
 * Published by the dock and read by the field, which draws the line's border
 * out of points rather than in CSS — so the border reacts to the cursor like
 * everything else on the page does.
 */
export const dockRect = {
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  on: false,
  /** The border is the line's answer to being approached; otherwise it is not there. */
  hovered: false,
};

/**
 * Where the install line should come to rest, in viewport pixels.
 *
 * The line used to ease to `innerHeight / 2`, which is the middle of the viewport and only the
 * middle of the closing section by coincidence. At the foot of the page it is not: the section has
 * scrolled up, so the line settled *below* the two buttons meant to sit under it, and the section's
 * title had left the screen. The section knows where its own gap is, so it publishes it here and
 * the line goes there.
 */
let target: number | null = null;

export function setDockTarget(y: number): void {
  target = y;
}

export function clearDockTarget(): void {
  target = null;
}

export function dockLandingY(viewportHeight: number): number {
  const middle = viewportHeight / 2;
  if (target === null || !Number.isFinite(target)) return middle;
  // Kept on screen with a margin either end: a gap that has scrolled past should not take the line
  // off the top with it, and one still below the fold should not park the line under the footer.
  const margin = viewportHeight * 0.18;
  return Math.max(margin, Math.min(viewportHeight - margin, target));
}
