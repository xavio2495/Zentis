/**
 * How brightly one letter of the wordmark burns under the cursor.
 *
 * The glow is a second, transparent copy of the word sitting exactly over the
 * real one, lit letter by letter. Keeping the falloff here means the curve can
 * be reasoned about without a pointer or a layout.
 */

/** How many letter-widths away the cursor still reaches. */
const REACH = 2.6;

export interface Letter {
  centerX: number;
  width: number;
}

export interface Band {
  centerY: number;
  halfHeight: number;
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

export function letterGlow(
  pointerX: number,
  pointerY: number,
  letter: Letter,
  band: Band,
): number {
  // Full strength anywhere over the word's own line, then falling away as the
  // cursor leaves it, so the glow does not snap off at the text's edge.
  const beyond = Math.abs(pointerY - band.centerY) - band.halfHeight;
  const vertical = clamp01(1 - Math.max(0, beyond) / (band.halfHeight * 1.2));
  if (vertical === 0) return 0;

  const away = Math.abs(pointerX - letter.centerX) / Math.max(letter.width, 1);
  const horizontal = clamp01(1 - away / REACH);

  // Squared, so the light gathers under the cursor rather than smearing evenly
  // across the whole word.
  return horizontal * horizontal * vertical;
}
