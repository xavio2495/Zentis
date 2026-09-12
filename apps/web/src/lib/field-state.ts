/**
 * Where the mark is, and how brightly it burns, for a given scroll position.
 *
 * This is the whole of the field's choreography, kept apart from three.js so it
 * can be reasoned about — and tested — without a canvas. The rule it exists to
 * hold: once there are words on screen the mark is either out of the text
 * column entirely, or too faint to read as texture across a paragraph.
 */

export const CAMERA_Z = 16;
export const FOV_DEGREES = 50;
/** Half the mark's width in world units, at scale 1. */
export const MARK_HALF_EXTENT = 4.5;

/** The prose column the page lays out: max-w-3xl, with the page's own padding. */
export function textColumnHalfWidth(viewportWidth: number): number {
  return Math.min(768, viewportWidth - 64) / 2;
}

/** Screen pixels per world unit at a given depth. */
export function pixelsPerWorldUnit(viewportHeight: number, positionZ: number): number {
  const depth = CAMERA_Z - positionZ;
  const visibleHeight = 2 * Math.tan((FOV_DEGREES / 2) * (Math.PI / 180)) * depth;
  return viewportHeight / visibleHeight;
}

export interface FieldInput {
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  docHeight: number;
}

export interface FieldState {
  positionX: number;
  positionZ: number;
  scale: number;
  rotationY: number;
  rotationX: number;
  opacity: number;
  scatter: number;
  /** The doorway the reader passes through, on the first screen only. */
  doorOpacity: number;
  doorScale: number;
  /** The field of light the whole page happens in. */
  starfieldOpacity: number;
  /** Scroll position where the traverse ends and the prose begins. */
  proseFrom: number;
  /** Scroll position where the prose ends and the scatter begins. */
  outroFrom: number;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/** How far the mark must sit from centre to be clear of the column, in world units. */
function clearanceWorld(viewportWidth: number, viewportHeight: number, scale: number, positionZ: number) {
  const perUnit = pixelsPerWorldUnit(viewportHeight, positionZ);
  const halfExtentPx = MARK_HALF_EXTENT * scale * perUnit;
  // a little air past the column edge, so it never grazes the text
  const neededPx = textColumnHalfWidth(viewportWidth) + halfExtentPx + 24;
  return { neededWorld: neededPx / perUnit, neededPx, halfExtentPx };
}

export function fieldState({
  scrollY,
  viewportWidth,
  viewportHeight,
  docHeight,
}: FieldInput): FieldState {
  const proseFrom = viewportHeight * 2.2;
  const outroFrom = docHeight - viewportHeight * 2.1;

  // The traverse finishes early and the mark holds centre for a moment, so the
  // move out of the column can complete *before* the first paragraph arrives
  // rather than crossing it on the way.
  const traverse = clamp(scrollY / (viewportHeight * 1.5), 0, 1);
  const eased = easeOut(traverse);

  const positionZ = -34 + 34 * eased;
  const scale = 0.22 + 0.78 * eased;
  const handoffFrom = viewportHeight * 1.65;
  const handoff = easeOut(clamp((scrollY - handoffFrom) / (proseFrom - handoffFrom), 0, 1));

  const { neededPx, halfExtentPx } = clearanceWorld(viewportWidth, viewportHeight, scale, positionZ);
  const perUnit = pixelsPerWorldUnit(viewportHeight, positionZ);

  // There is only room to stand beside the column on a wide viewport. Where
  // there is, the mark moves out and keeps some of its light; where there is
  // not, it gets out of the way by going dark rather than by hiding off-screen
  // at a size that would still bleed back in.
  const roomBeside = neededPx <= viewportWidth / 2 + halfExtentPx * 0.35;
  const restingOpacity = roomBeside ? 0.4 : 0.02;
  const offscreenWorld = (viewportWidth / 2 + halfExtentPx) / perUnit;
  const positionX = handoff * (roomBeside ? neededPx / perUnit : offscreenWorld);

  const past = clamp((scrollY - proseFrom) / (viewportHeight * 2), 0, 1);
  const scatter = easeOut(clamp((scrollY - outroFrom) / (viewportHeight * 1.4), 0, 1));

  // Brightness falls to its resting value across the handoff, then comes back
  // for the scatter, which is the one moment the field is the subject again.
  const arrival = 0.25 + 0.75 * eased;
  const yielded = 1 + (restingOpacity - 1) * handoff;
  const opacity = arrival * (yielded + (0.85 - yielded) * scatter);

  // The doorway belongs to the first screen. It opens out as the reader comes
  // through it and is gone well before any prose arrives.
  const through = easeOut(clamp(scrollY / (viewportHeight * 1.2), 0, 1));
  const doorOpacity = 1 - through;
  const doorScale = 1 + through * 1.4;

  // The far field is faint behind the closed door and opens up as it goes. It
  // never leaves: it is the room the rest of the page happens in.
  const starfieldOpacity = 0.12 + 0.43 * eased;

  return {
    positionX,
    positionZ,
    scale,
    rotationY: past * Math.PI * 0.9,
    rotationX: past * 0.2,
    opacity,
    scatter,
    doorOpacity,
    doorScale,
    starfieldOpacity,
    proseFrom,
    outroFrom,
  };
}
