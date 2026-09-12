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
