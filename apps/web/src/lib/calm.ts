/**
 * The quiet the text keeps around itself.
 *
 * Points that fall behind a block of type are dimmed rather than moved, so the
 * words stay readable without the field having to get out of the way. The shader
 * compares against a rectangle in clip space, so a screen rectangle has to be
 * converted — and the y axis flips on the way, which is exactly the sort of
 * thing that is invisible until the dimming appears in the wrong half of the
 * page.
 */

export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface NdcRect {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

/**
 * A screen rectangle in the units the shader works in: both axes normalised by
 * half the viewport height, so a square on screen is square in the comparison
 * once the shader has corrected x for aspect.
 */
export function toNdcRect(box: ScreenBox, viewportWidth: number, viewportHeight: number): NdcRect {
  const perUnit = viewportHeight > 0 ? 2 / viewportHeight : 0;
  return {
    x: (box.left + box.width / 2 - viewportWidth / 2) * perUnit,
    y: (viewportHeight / 2 - (box.top + box.height / 2)) * perUnit,
    halfWidth: (box.width / 2) * perUnit,
    halfHeight: (box.height / 2) * perUnit,
  };
}

/** Where the hero's type is, for whatever is drawing behind it. */
export const calmRect: NdcRect & { on: boolean } = {
  x: 0,
  y: 0,
  halfWidth: 0,
  halfHeight: 0,
  on: false,
};
