/**
 * The Zentis mark, drawn from the same geometry the SVG is.
 *
 * `claude-docs/pfp_animated.svg` is three polygons on a 1000×1000 field: two chains and the bridge
 * between them. They are transcribed here as points rather than redrawn as characters, so what a
 * terminal shows is the logo sampled onto a grid instead of somebody's impression of it — and it
 * stays the logo when the grid changes size.
 *
 * The animation is the file's as well. Both chains sweep in over the first 1.2 seconds, from
 * opposite sides; the bridge grows out of its own middle from 1.3 to 2.3; and at 2.4 the colours
 * invert, black on the brand green, which is where the still image ends. Then it holds and loops,
 * because a console that is waiting should look like it is still alive.
 */
import { ACCENT } from "./theme.js";

/** The mark's colour, which is the brand's one accent. */
export const LOGO_GREEN = ACCENT;

/**
 * The moment the mark is complete and still in the brand green, before the colours flip.
 *
 * What a page draws: a page repaints when its data changes, so an animation on one would freeze
 * wherever the last poll left it. The finished mark is the same mark, and it holds still.
 */
export const LOGO_COMPLETE_MS = 2_300;

/** The still image, and then a beat before it begins again. */
const FLIP_END_MS = 3_000;
export const LOGO_PERIOD_MS = 3_600;

type Point = readonly [number, number];

/** Chain B in the file: the upper bar, flat on the left and rising to the right. */
const CHAIN_UPPER: Point[] = [
  [0, 364.009],
  [272.727, 363.938],
  [727.225, 182],
  [727.249, 272.909],
  [272.751, 454.847],
  [0.0239091, 454.918],
];

/** Chain A: the lower bar, rising from the left and flat to the right. */
const CHAIN_LOWER: Point[] = [
  [999.999, 636.737],
  [727.272, 636.737],
  [272.727, 818.555],
  [272.727, 727.646],
  [727.272, 545.828],
  [999.999, 545.828],
];

/** The connector, a diagonal from the upper right down to the lower left. */
const BRIDGE: Point[] = [
  [594, 257],
  [663.282, 297],
  [405.282, 743.869],
  [336, 703.869],
];

/** Even-odd containment, which is the rule the SVG's own fill uses. */
function inside(polygon: Point[], x: number, y: number): boolean {
  let within = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

/**
 * The file's easing, near enough: `cubic-bezier(0.4, 0, 0.2, 1)` is the standard ease-in-out, and at
 * the resolution of a character cell the difference between it and this is invisible.
 */
const eased = (p: number): number => {
  const t = Math.max(0, Math.min(1, p));
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

export interface LogoCell {
  readonly on: boolean;
}

export interface LogoFrame {
  readonly rows: { readonly cells: LogoCell[] }[];
  /** black on green once the mark is complete, as the file ends */
  readonly inverted: boolean;
  readonly colour: string;
}

/**
 * The field, which is the file's whole square.
 *
 * Cropping to the ink bought a few rows and cost the shape: the mark came out flattened, and with
 * nothing between its chains and the edge of the grid it ran straight into whatever was drawn above
 * and below it. The margin in the file is part of the artwork, so the grid is the square.
 */
const FIELD = 1000;

export function logoFrame(elapsedMs: number, width: number, height: number): LogoFrame {
  const at = ((elapsedMs % LOGO_PERIOD_MS) + LOGO_PERIOD_MS) % LOGO_PERIOD_MS;
  if (width <= 0 || height <= 0) return { rows: [], inverted: false, colour: LOGO_GREEN };

  // The chains: one revealed left to right, the other right to left, both over the first 1.2s.
  const sweep = eased(at / 1_200);
  const upperTo = 727.249 * sweep;
  const lowerFrom = 999.999 - 727.272 * sweep;

  // The bridge: from 1.3s, growing out of its own centre for a second.
  const grow = eased((at - 1_300) / 1_000);
  const bridgeTop = 500.435 - (500.435 - 257) * grow;
  const bridgeBottom = bridgeTop + 486.869 * grow;

  // A cell is not a point: it covers a rectangle of the field, and the reveals are rectangles too.
  // Testing a single centre made the bridge — which starts as a band a few units tall — invisible
  // until it had grown past half a row, so it appeared to jump rather than grow. The shapes are
  // sampled at several points inside each cell, and the reveals are tested as overlaps.
  const SAMPLES = [0.2, 0.5, 0.8];
  const rows = Array.from({ length: height }, (_, row) => {
    const y0 = (row / height) * FIELD;
    const y1 = ((row + 1) / height) * FIELD;
    const ys = SAMPLES.map((s) => y0 + (y1 - y0) * s);
    const cells = Array.from({ length: width }, (_, column) => {
      const x0 = (column / width) * FIELD;
      const x1 = ((column + 1) / width) * FIELD;
      const xs = SAMPLES.map((s) => x0 + (x1 - x0) * s);
      const covers = (polygon: Point[]) => ys.some((y) => xs.some((x) => inside(polygon, x, y)));

      const on =
        (x0 < upperTo && covers(CHAIN_UPPER)) ||
        (x1 > lowerFrom && covers(CHAIN_LOWER)) ||
        (grow > 0 && y1 >= bridgeTop && y0 <= bridgeBottom && covers(BRIDGE));
      return { on };
    });
    return { cells };
  });

  return { rows, inverted: at >= 2_400 && at < LOGO_PERIOD_MS, colour: LOGO_GREEN };
}

/**
 * How wide and tall the mark should be drawn in a region.
 *
 * As large as the space allows, up to a cap that keeps it a mark rather than a wallpaper. Bigger is
 * not vanity here: every cell is a sample of a diagonal edge, so a small grid turns the bridge into
 * a staircase and the chains into a smear.
 *
 * The ratio is the file's square read through a character cell, which is about twice as tall as it
 * is wide, so the grid is two columns for every row — and then fifteen percent wider again, because
 * a cell is not exactly half a square and the mark came out narrow without it.
 */
/** Columns per row: two for the cell's shape, and the fifteen percent the mark is stretched by. */
export const LOGO_CELLS_PER_ROW = 2 * 1.15;

export function logoSize(cols: number, rows: number): { width: number; height: number } {
  const height = Math.max(0, Math.min(rows, Math.floor((cols - 2) / LOGO_CELLS_PER_ROW), 24));
  const width = Math.round(height * LOGO_CELLS_PER_ROW);
  // Below about twenty cells across there is no diagonal left to draw, only its staircase; better to
  // show nothing and leave the words the room.
  return width < 20 ? { width: 0, height: 0 } : { width, height };
}
