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
/**
 * How far in from the gate's edges the mark is kept. Barely at all: the gate is
 * a frame the mark moves within, not a box it is packed into, so it is allowed
 * right out into the corners and to overhang the edge on the way.
 */
const GATE_INSET = 0.04;

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
/** The triangle's three corners, in world units. */
export function gateCorners(inset = 0): { x: number; y: number }[] {
  const gate = gateShape();
  const centroidY = gate.incircleCenterY;
  const raw = [
    { x: -gate.side / 2, y: gate.topY },
    { x: gate.side / 2, y: gate.topY },
    { x: 0, y: gate.apexY },
  ];
  if (inset === 0) return raw;
  // shrink about the centroid, which for a triangle keeps it similar and
  // centred — the mark's own body is what the inset makes room for
  const keep = 1 - inset;
  return raw.map((c) => ({ x: c.x * keep, y: centroidY + (c.y - centroidY) * keep }));
}

/** Is this point inside the triangle the mark is allowed to roam? */
export function insideGate(x: number, y: number, inset = GATE_INSET): boolean {
  const corners = gateCorners(inset);
  let hit = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a = corners[i];
    const b = corners[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** The nearest point on a segment. */
function closestOnSegment(
  x: number,
  y: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Holds a point inside the gate. Inside, it is left where it is; outside, it is
 * put down on the nearest edge — so the mark tracks the cursor right out to the
 * corners instead of being penned into a circle in the middle.
 */
export function clampIntoGate(x: number, y: number, inset = GATE_INSET) {
  if (insideGate(x, y, inset)) return { x, y };
  const corners = gateCorners(inset);
  let best = { x, y };
  let bestDistance = Infinity;
  for (let i = 0; i < corners.length; i++) {
    const point = closestOnSegment(x, y, corners[i], corners[(i + 1) % corners.length]);
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  // a hair inside the edge rather than exactly on it, so the mark is never
  // ambiguously half in and half out
  const centroidY = gateShape().incircleCenterY;
  return {
    x: best.x * 0.999,
    y: centroidY + (best.y - centroidY) * 0.999,
  };
}

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
  /** Where the cursor itself is, in world units, unclamped. */
  pointerWorldX: number;
  pointerWorldY: number;
  /** Whether there is a cursor to cast light and push points at all. */
  pointerPresent: boolean;
  /** How much further from the camera the mark is than the gate. */
  depthRatio: number;
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
  const starfieldOpacity = 0.34 + 0.34 * eased;

  // While the gate stands, the mark answers the cursor — held inside the gate,
  // so it can be led anywhere within the frame without escaping it. The hold
  // lets go as the reader comes through.
  const held = 1 - through;
  const reach = Math.tan((FOV_DEGREES / 2) * (Math.PI / 180)) * CAMERA_Z;
  const pointerWorldX = pointer ? pointer.x * reach * (viewportWidth / viewportHeight) : 0;
  const pointerWorldY = pointer ? pointer.y * reach : 0;

  // The mark sits further from the camera than the gate does, so a world
  // distance covers less of the screen there. Its allowance is the gate's shape
  // as the reader sees it, grown by that ratio — otherwise the mark rattles
  // around in the middle of a frame it can never reach the corners of.
  const depthRatio = (CAMERA_Z - positionZ) / CAMERA_Z;

  let markOffsetX = 0;
  let markOffsetY = 0;
  if (pointer && held > 0) {
    const inGate = clampIntoGate(pointerWorldX, pointerWorldY);
    markOffsetX = inGate.x * depthRatio * held;
    markOffsetY = inGate.y * depthRatio * held;
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
    pointerWorldX,
    pointerWorldY,
    pointerPresent: !!pointer,
    depthRatio,
    proseFrom,
    outroFrom,
  };
}
