/**
 * Where the mark stands, given the figure the reader is looking at.
 *
 * The page lays its figures off-centre and alternating, and the mark used to move to a fixed
 * positive offset — always to the right, and sized against a text column that is no longer centred.
 * So on every right-hand figure the drawing and the mark ended up in the same half with the left of
 * the screen empty, and on a wide monitor the mark was half off the right edge as well.
 *
 * The rule is simply the opposite half: the figure takes one, the mark takes the other, centred in
 * it and level with the figure. Where no half is wide enough to hold the mark clear of the words —
 * a phone — there is no slot, and the caller stands the mark down rather than sliding it off the
 * side where it bleeds back in.
 */
export type FigureSide = "left" | "right" | null;

export interface Slot {
  /** true when there is room to stand beside the figure at all */
  readonly beside: boolean;
  /** viewport pixels from the left edge */
  readonly centreX: number;
  readonly centreY: number;
}

/** How much clear space the mark wants between itself and the viewport's edge. */
const EDGE = 24;

export function markSlot({
  side,
  viewportWidth,
  viewportHeight,
  halfExtentPx,
  figureCentreY,
}: {
  side: FigureSide;
  viewportWidth: number;
  viewportHeight: number;
  /** half the mark's drawn width, in screen pixels */
  halfExtentPx: number;
  figureCentreY: number;
}): Slot {
  const half = viewportWidth / 2;
  // The whole mark has to fit inside its own half, not merely inside the viewport. Checking against
  // the viewport lets a mark wider than the half sit "beside" the figure while reaching across the
  // centre line into it — which is the collision this function exists to prevent, in miniature.
  const fits = side !== null && 2 * halfExtentPx + EDGE <= half;
  if (!fits) return { beside: false, centreX: half, centreY: viewportHeight / 2 };

  // The middle of the half the figure is not using, kept inside that half at both ends.
  const wanted = side === "right" ? half / 2 : half + half / 2;
  const [low, high] = side === "right" ? [0, half] : [half, viewportWidth];
  const centreX = Math.max(low + halfExtentPx + EDGE, Math.min(high - halfExtentPx - EDGE, wanted));

  // Level with the figure, but never so far up or down that it leaves the frame: a figure entering
  // from below should not take the mark off the bottom with it.
  const centreY = Math.max(halfExtentPx * 0.5 + EDGE, Math.min(viewportHeight - halfExtentPx * 0.5 - EDGE, figureCentreY));

  return { beside: true, centreX, centreY };
}

/**
 * The figure the reader is actually looking at: the one whose middle is nearest the viewport's.
 *
 * Read from the DOM each frame rather than pushed from React, for the same reason the install line
 * reads its clearance that way — a figure added to the page later is covered without anything else
 * being told about it.
 */
export function nearestFigure(): { side: FigureSide; centreY: number } {
  if (typeof document === "undefined") return { side: null, centreY: 0 };
  const middle = window.innerHeight / 2;
  let best: { side: FigureSide; centreY: number; distance: number } = { side: null, centreY: middle, distance: Infinity };

  for (const node of document.querySelectorAll<HTMLElement>("[data-figure-side]")) {
    const box = node.getBoundingClientRect();
    // Off screen entirely: not what the reader is on.
    if (box.bottom < 0 || box.top > window.innerHeight) continue;
    const centreY = box.top + box.height / 2;
    const distance = Math.abs(centreY - middle);
    if (distance < best.distance) {
      const side = node.dataset.figureSide === "left" ? "left" : "right";
      best = { side, centreY, distance };
    }
  }
  return { side: best.side, centreY: best.centreY };
}
