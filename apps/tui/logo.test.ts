import { expect, test } from "bun:test";
import { LOGO_CELLS_PER_ROW, LOGO_GREEN, LOGO_PERIOD_MS, logoFrame, logoSize } from "./src/logo.js";

/**
 * The mark, drawn from the same geometry the SVG is.
 *
 * Not hand-drawn ASCII: the three shapes are the polygons out of `pfp_animated.svg`, sampled onto
 * whatever grid the terminal gives, so the thing on screen is the logo rather than someone's
 * impression of it. The animation is that file's too — the two chains sweep in from opposite sides,
 * the bridge grows out of its own centre, and then the colours invert.
 */
const filled = (rows: { cells: { on: boolean }[] }[]) => rows.flatMap((r) => r.cells).filter((c) => c.on).length;

test("the mark is the three shapes, and it fills the grid it is given", () => {
  const frame = logoFrame(LOGO_PERIOD_MS - 1, 40, 20);
  expect(frame.rows).toHaveLength(20);
  for (const row of frame.rows) expect(row.cells).toHaveLength(40);
  // Finished, it is a substantial mark rather than a scattering of cells.
  expect(filled(frame.rows)).toBeGreaterThan(100);
});

test("the chains sweep in from opposite sides, as the file has them", () => {
  // A fifth of the way through the first phase: the upper chain has entered from the left and the
  // lower one from the right, so each has cells on its own side and none on the other.
  const early = logoFrame(300, 40, 20);
  const columnHas = (x: number) => early.rows.some((row) => row.cells[x]?.on === true);
  expect(columnHas(1)).toBe(true);
  expect(columnHas(38)).toBe(true);
  expect(columnHas(20)).toBe(false);
});

test("the bridge arrives after the chains, growing from its own middle", () => {
  const chainsOnly = logoFrame(1_200, 40, 20);
  const withBridge = logoFrame(2_200, 40, 20);
  expect(filled(withBridge.rows)).toBeGreaterThan(filled(chainsOnly.rows));
  // It grows outward from the centre, so the middle rows carry it before the outer ones do.
  const middle = logoFrame(1_500, 40, 20);
  const rowHas = (y: number) => middle.rows[y]!.cells.some((c) => c.on);
  expect(rowHas(10)).toBe(true);
});

test("the colours invert at the end, black on the brand green", () => {
  const during = logoFrame(1_000, 40, 20);
  expect(during.inverted).toBe(false);
  expect(during.colour).toBe(LOGO_GREEN);
  const after = logoFrame(2_900, 40, 20);
  expect(after.inverted).toBe(true);
});

test("it loops, so the screen it lives on is never still", () => {
  const start = logoFrame(0, 24, 12);
  const looped = logoFrame(LOGO_PERIOD_MS, 24, 12);
  expect(filled(looped.rows)).toBe(filled(start.rows));
  expect(logoFrame(LOGO_PERIOD_MS * 3 + 300, 24, 12).rows).toEqual(logoFrame(300, 24, 12).rows);
});

test("a grid too small to say anything is empty rather than a smear", () => {
  const tiny = logoFrame(1_500, 0, 0);
  expect(tiny.rows).toEqual([]);
});

test("the grid is the file's own square, so the mark is neither flattened nor cropped", () => {
  // A character cell is about twice as tall as it is wide, so the file's square field is twice as
  // many columns as rows. Any other ratio is the logo squashed, and cropping to the ink — which
  // bought a few rows — is what pushed the chains into the text above and below it.
  const size = logoSize(120, 30);
  expect(size.width).toBe(Math.round(size.height * LOGO_CELLS_PER_ROW));

  // The margin the file has above and below its ink is kept, which is what holds the mark clear of
  // whatever is drawn beside it.
  const frame = logoFrame(LOGO_PERIOD_MS - 1, size.width, size.height);
  expect(frame.rows[0]!.cells.some((cell) => cell.on)).toBe(false);
  expect(frame.rows.at(-1)!.cells.some((cell) => cell.on)).toBe(false);
});
