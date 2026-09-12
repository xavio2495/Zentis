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

/** How much of the visible height the gate stands across. */
const GATE_SHARE = 0.62;

export interface Gate {
  /** Side length and height of the triangle, in world units. */
  side: number;
  height: number;
  /** y of the flat top edge, and of the point it stands on. */
  topY: number;
  apexY: number;
  /** The largest circle that fits inside it — where the mark is allowed to go. */
  incircleRadius: number;
  incircleCenterY: number;
}

/**
 * The gate: an equilateral triangle standing on its point, sized against what
 * the camera can see so it frames the wordmark at any viewport.
 */
export function gateShape(): Gate {
  const visibleHeight = 2 * Math.tan((FOV_DEGREES / 2) * (Math.PI / 180)) * CAMERA_Z;
  const height = visibleHeight * GATE_SHARE;
  const side = (2 * height) / Math.sqrt(3);
  return {
    side,
    height,
    topY: height / 2,
    apexY: -height / 2,
    // for an equilateral triangle the inradius is a third of the height, and it
    // sits on the centroid
    incircleRadius: height / 3,
    incircleCenterY: height / 6,
  };
}

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
  /** Cursor in normalised device coordinates, if there is one. */
  pointer?: { x: number; y: number };
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
  /** Where the cursor has drawn the mark, held inside the gate. */
  markOffsetX: number;
  markOffsetY: number;
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
  pointer,
}: FieldInput): FieldState {
  const proseFrom = viewportHeight * 2.2;
  const outroFrom = docHeight - viewportHeight * 2.1;

  // The traverse finishes early and the mark holds centre for a moment, so the
  // move out of the column can complete *before* the first paragraph arrives
  // rather than crossing it on the way.
  const traverse = clamp(scrollY / (viewportHeight * 1.5), 0, 1);
  const eased = easeOut(traverse);

  const positionZ = -34 + 34 * eased;
  const scale = 0.32 + 0.68 * eased;
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

  // The far field is faint behind the closed gate and opens up as it goes. It
  // never leaves: it is the room the rest of the page happens in.
  const starfieldOpacity = 0.12 + 0.43 * eased;

  // While the gate stands, the mark answers the cursor — but it is held inside
  // the gate, so it can be led around without ever escaping the frame. The hold
  // lets go as the reader comes through.
  const gate = gateShape();
  const held = 1 - through;
  let markOffsetX = 0;
  let markOffsetY = 0;
  if (pointer && held > 0) {
    const reachY = Math.tan((FOV_DEGREES / 2) * (Math.PI / 180)) * CAMERA_Z;
    const wantX = pointer.x * reachY * (viewportWidth / viewportHeight);
    const wantY = pointer.y * reachY;

    const room = Math.max(0, gate.incircleRadius - MARK_HALF_EXTENT * scale * 0.9);
    const dx = wantX;
    const dy = wantY - gate.incircleCenterY;
    const distance = Math.hypot(dx, dy);
    const scaled = distance > room && distance > 0 ? room / distance : 1;

    markOffsetX = dx * scaled * held;
    markOffsetY = (gate.incircleCenterY + dy * scaled) * held;
  }

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
    markOffsetX,
    markOffsetY,
    proseFrom,
    outroFrom,
  };
}
