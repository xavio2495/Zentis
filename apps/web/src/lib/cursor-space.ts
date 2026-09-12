/**
 * The cursor, in the mark's own frame.
 *
 * The cursor is a ray, not a point: where it lands in the world depends on how
 * far away you ask. The mark spends the traverse well behind the plane the
 * cursor's position is measured at, and its own offset is already carried to
 * its depth — so the cursor has to be carried there too before the two can be
 * compared. Miss that and the cursor appears to sit some multiple of its true
 * distance away, and the mark simply never notices it.
 */

export function cursorInMarkSpace(
  pointerWorldX: number,
  pointerWorldY: number,
  depthRatio: number,
  groupX: number,
  groupY: number,
  scale: number,
): { x: number; y: number } {
  const divisor = Math.max(scale, 1e-4);
  return {
    x: (pointerWorldX * depthRatio - groupX) / divisor,
    y: (pointerWorldY * depthRatio - groupY) / divisor,
  };
}
