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
 * Where the install line is, and whether it is drawn, as the page closes.
 *
 * The line has one job at the foot of the page and another in the closing section, and the mistake
 * made twice was treating those as one position to move between. Interpolating from the foot to the
 * section's gap walks the line through every height in between, and one of them is the "Try it out."
 * heading. Holding it at the foot until the gap comes down is no better: the heading sits about
 * 118px above the gap, the foot is near the bottom of the viewport, and the page carries the
 * heading up through the foot while the line waits there. The line does not have to move to be hit.
 *
 * So it is in one place at a time. At the foot while the page is running; in the gap once the
 * section has arrived; and in the interval between, where the two could occupy the same band, it is
 * not drawn at all. Nothing can overlap something that is not there, and the reader sees the line
 * leave the bar and reappear in the section rather than slide across the words.
 */
/**
 * How far below the fold the closing section starts pushing the line out, in pixels.
 *
 * Larger than the distance between the line and the bottom edge, so the line is gone before the
 * heading is drawn rather than fading while it passes.
 */
const ARRIVAL_LEAD = 110;

export interface DockPlacement {
  readonly y: number;
  readonly opacity: number;
}

let gapCentre: number | null = null;
let topEdge: number | null = null;

export function setDockTarget(centre: number, top: number): void {
  gapCentre = centre;
  topEdge = top;
}

export function clearDockTarget(): void {
  gapCentre = null;
  topEdge = null;
}

/** The placement for whatever the closing section last published. */
export function dockNow(footY: number, viewportHeight: number): DockPlacement {
  return dockPlacement({ footY, viewportHeight, gapCentre, topEdge });
}

export function dockPlacement({
  footY,
  viewportHeight,
  /** the middle of the section's gap, in viewport pixels; null before the section exists */
  gapCentre,
  /** the top of the section's content, which is where the heading is */
  topEdge,
}: {
  footY: number;
  viewportHeight: number;
  gapCentre: number | null;
  topEdge: number | null;
}): DockPlacement {
  const gap = gapCentre !== null && Number.isFinite(gapCentre) ? gapCentre : null;
  const top = topEdge !== null && Number.isFinite(topEdge) ? topEdge : null;

  // No section, or nothing measurable about it: the line does the only job it has, at the foot.
  if (gap === null || top === null) return { y: footY, opacity: 1 };

  // Arrived: the gap has come down to the foot or past it, and the line is the gap.
  if (gap <= footY) return { y: gap, opacity: 1 };

  // Arriving. The fade has to be finished *before* the heading crosses the bottom edge, not while
  // it climbs: the line rides about sixty pixels above that edge, so by the time the heading is on
  // screen at all the two are already close enough to read as one. So the fade runs over the last
  // stretch of the heading's approach, while it is still below the fold.
  const travelled = (viewportHeight + ARRIVAL_LEAD - top) / ARRIVAL_LEAD;
  return { y: footY, opacity: Math.max(0, Math.min(1, 1 - travelled)) };
}
