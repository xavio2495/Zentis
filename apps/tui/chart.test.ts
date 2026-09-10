import { expect, test } from "bun:test";
import { axisMarks, plot } from "./src/chart.js";

const ramp = (n: number, from: number, to: number) =>
  Array.from({ length: n }, (_, i) => ({
    // Newest first, as the subgraph answers.
    timestamp: BigInt(1000 + (n - 1 - i) * 60),
    mid: BigInt(Math.round((from + ((to - from) * (n - 1 - i)) / (n - 1)) * 1e18)),
  }));

const WINDOW = 604800n;

test("every row is exactly the requested width, and there are exactly `height` of them", () => {
  const { byKey } = plot([{ key: "a", samples: ramp(50, 1, 1.1) }], 40, 6, WINDOW);
  const p = byKey.get("a")!;
  expect(p.rows.length).toBe(6);
  for (const row of p.rows) expect([...row].length).toBe(40);
});

test("a rising series is drawn low on the left and high on the right", () => {
  const { byKey } = plot([{ key: "a", samples: ramp(60, 1, 2) }], 40, 8, WINDOW);
  const rows = byKey.get("a")!.rows;
  const inked = (row: string, half: "l" | "r") =>
    [...row].slice(half === "l" ? 0 : 20, half === "l" ? 20 : 40).filter((c) => c !== " ").length;
  // The top row carries the right-hand end of a rising line; the bottom row the left-hand end.
  expect(inked(rows[0]!, "r")).toBeGreaterThan(inked(rows[0]!, "l"));
  expect(inked(rows[rows.length - 1]!, "l")).toBeGreaterThan(inked(rows[rows.length - 1]!, "r"));
});

test("each series gets its own vertical scale, and reports it", () => {
  // Deliberately not one shared scale. A testnet reference pool really does step to a twentieth of
  // where it started and stay there, and on a shared axis that leg owns the range while the other
  // two draw as flat lines — no percentile band or log scale rescues it, because the outlier is not
  // a spike, it is where that leg now lives. Three bands, each labelled with its own extent, compare
  // the shapes and cannot be read as sharing a number.
  const { byKey } = plot([{ key: "gentle", samples: ramp(40, 1, 1.1) }], 30, 6, WINDOW);
  const p = byKey.get("gentle")!;
  expect(p.minRatio).toBeLessThan(p.maxRatio);
  expect(p.maxRatio / p.minRatio).toBeLessThan(1.2);
});

test("each series is normalised to its own start, so different mids draw the same shape", () => {
  // Two pools whose mids differ by three orders of magnitude and move by the same fraction draw
  // identically; against raw mids one line would be flat against the frame.
  const cheap = plot([{ key: "a", samples: ramp(40, 1, 1.2) }], 30, 6, WINDOW).byKey.get("a")!;
  const dear = plot([{ key: "a", samples: ramp(40, 1000, 1200) }], 30, 6, WINDOW).byKey.get("a")!;
  expect(cheap.rows).toEqual(dear.rows);
});

test("samples outside the volatility window are not plotted", () => {
  const samples = [
    { timestamp: 10_000n, mid: 10n ** 18n },
    { timestamp: 1n, mid: 5n * 10n ** 17n }, // far outside a 60-second window
  ];
  const { from } = plot([{ key: "a", samples }], 20, 4, 60n);
  expect(from).toBe(10_000n);
});

test("no samples draws blank rows rather than throwing or a stray axis", () => {
  const { byKey, from } = plot([{ key: "a", samples: [] }], 20, 4, WINDOW);
  expect(from).toBeNull();
  expect(byKey.get("a")!.rows).toEqual(Array(4).fill(" ".repeat(20)));
});

test("axis marks land on the same clock as the lines", () => {
  const row = axisMarks(
    [
      { at: 100n, glyph: "|" },
      { at: 200n, glyph: "f" },
    ],
    100n,
    200n,
    11,
  );
  expect(row.length).toBe(11);
  expect(row[0]).toBe("|");
  expect(row[10]).toBe("f");
});

test("a mark outside the plotted window is dropped, not clamped onto an end", () => {
  // Clamping would put a fill at an instant it did not happen, which is the one thing the beat
  // cannot afford to get wrong.
  const row = axisMarks([{ at: 50n, glyph: "f" }], 100n, 200n, 11);
  expect(row.trim()).toBe("");
});

test("one leg moving twenty-fold does not flatten another plotted beside it", () => {
  // A Base Sepolia reference pool really does step from ×1.045 to ×0.049 in one swap. On a linear
  // scale that outlier owns the whole vertical range and the other legs draw as flat lines against
  // the frame, which is the opposite of what a comparison chart is for. Ratios are compared in log
  // space for the same reason returns always are.
  // A step, not two overlaid ramps: the halves must have distinct timestamps or they average into
  // one line at the midpoint, which is a broken fixture rather than a squashed chart.
  const wild = Array.from({ length: 40 }, (_, i) => ({
    timestamp: BigInt(1000 + (39 - i) * 60),
    mid: BigInt(Math.round((39 - i < 20 ? 1 + (39 - i) * 0.0025 : 0.05) * 1e18)),
  }));
  const inkedRows = (samples: ReturnType<typeof ramp>) =>
    plot([{ key: "a", samples }], 40, 8, WINDOW)
      .byKey.get("a")!
      .rows.filter((row) => row.trim() !== "").length;

  // Each is plotted on its own scale, so the 10% mover uses its band and the 20x mover uses its own.
  expect(inkedRows(ramp(40, 1, 1.1))).toBeGreaterThan(1);
  expect(inkedRows(wild)).toBeGreaterThan(1);
});

test("the plotted band is reported so each graph can be labelled with its own range", () => {
  const p = plot([{ key: "a", samples: ramp(30, 1, 2) }], 20, 4, WINDOW).byKey.get("a")!;
  expect(p.minRatio).toBeGreaterThan(0.9);
  expect(p.maxRatio).toBeLessThan(2.1);
  expect(p.maxRatio).toBeGreaterThan(p.minRatio);
});

test("a well-behaved series is plotted whole, with nothing reported beyond the band", () => {
  // Banding unconditionally clips a tenth of the points by construction, so an "(N beyond)" note
  // would appear on every graph and mean nothing.
  const calm = plot([{ key: "a", samples: ramp(60, 1, 1.2) }], 30, 6, WINDOW).byKey.get("a")!;
  expect(calm.clipped).toBe(0);
  expect(calm.minRatio).toBeCloseTo(1, 2);
  expect(calm.maxRatio).toBeCloseTo(1.2, 2);
});

test("a spike is banded out and counted; a sustained step is not, because it is not an outlier", () => {
  // The distinction matters for real data: Base's pool steps to a twentieth and stays there, and
  // both levels are where that leg genuinely lived. Banding those away would hide half its history.
  // A single bad print is different, and is what the band is for.
  const spike = Array.from({ length: 40 }, (_, i) => ({
    timestamp: BigInt(1000 + (39 - i) * 60),
    mid: BigInt(Math.round((39 - i === 5 ? 0.02 : 1) * 1e18)),
  }));
  expect(plot([{ key: "a", samples: spike }], 30, 6, WINDOW).byKey.get("a")!.clipped).toBeGreaterThan(0);

  const step = Array.from({ length: 40 }, (_, i) => ({
    timestamp: BigInt(1000 + (39 - i) * 60),
    mid: BigInt(Math.round((39 - i < 20 ? 1 : 0.05) * 1e18)),
  }));
  expect(plot([{ key: "a", samples: step }], 30, 6, WINDOW).byKey.get("a")!.clipped).toBe(0);
});

test("sparse samples are joined into a line rather than left as scattered dots", () => {
  // A week of swaps across a few hundred sub-columns leaves most of them empty. Plotting only the
  // columns that carry a sample reads as noise; the gaps between them have to be drawn.
  const sparse = [0, 10, 20, 30].map((i) => ({
    timestamp: BigInt(1000 + (30 - i) * 600),
    mid: BigInt(Math.round((1 + i * 0.01) * 1e18)),
  }));
  const rows = plot([{ key: "a", samples: sparse }], 40, 6, WINDOW).byKey.get("a")!.rows;

  const inked = rows.join("").split("").filter((c) => c !== " ").length;
  // Four samples plotted as points would ink four cells; joined, they ink most of the width.
  expect(inked).toBeGreaterThan(20);

  // And the line is continuous: no column between the first and last inked one is empty.
  const columns = Array.from({ length: 40 }, (_, x) => rows.some((row) => row[x] !== " "));
  const first = columns.indexOf(true);
  const last = columns.lastIndexOf(true);
  expect(columns.slice(first, last + 1).every(Boolean)).toBe(true);
});

test("the line is drawn in box-drawing characters that join, never in braille dots", () => {
  // Braille renders as scattered dots in common terminal fonts; the user's screenshot showed the
  // chart as a dotted trail. Box-drawing characters join cell to cell in any monospace font.
  const rows = plot([{ key: "a", samples: ramp(40, 1, 1.3) }], 30, 6, WINDOW).byKey.get("a")!.rows;
  const glyphs = new Set(rows.join("").replace(/ /g, ""));
  for (const glyph of glyphs) expect("─│╭╮╰╯").toContain(glyph);
  expect([...rows.join("")].some((c) => c.charCodeAt(0) >= 0x2800 && c.charCodeAt(0) <= 0x28ff)).toBe(false);
});

test("a price that holds between swaps is drawn flat, and a swap is a vertical step", () => {
  // A pool's price is a step function. A slope between two swaps would draw prices nobody traded.
  const step = [
    { timestamp: 2000n, mid: 2n * 10n ** 18n },
    { timestamp: 1500n, mid: 2n * 10n ** 18n },
    { timestamp: 1400n, mid: 10n ** 18n },
    { timestamp: 1000n, mid: 10n ** 18n },
  ];
  const rows = plot([{ key: "a", samples: step }], 20, 5, WINDOW).byKey.get("a")!.rows;
  const text = rows.join("\n");
  expect(text).toContain("╯"); // the swap turns up out of the low run
  expect(text).toContain("╭"); // and into the high one
  expect(rows[0]!.includes("─")).toBe(true); // the high price holds along the top row
  expect(rows[rows.length - 1]!.includes("─")).toBe(true); // the low one along the bottom
});
