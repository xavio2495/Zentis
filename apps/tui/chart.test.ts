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

test("three series share one vertical scale, so their moves are comparable", () => {
  const { byKey } = plot(
    [
      { key: "flat", samples: ramp(40, 1, 1) },
      { key: "up", samples: ramp(40, 1, 1.5) },
    ],
    30,
    6,
    WINDOW,
  );
  expect(byKey.get("flat")!.minRatio).toBe(byKey.get("up")!.minRatio);
  expect(byKey.get("flat")!.maxRatio).toBe(byKey.get("up")!.maxRatio);
});

test("each series is normalised to its own start, so different mids still compare", () => {
  // Two pools whose mids differ by three orders of magnitude and move by the same fraction should
  // draw the same shape; against raw mids one line would be flat against the frame.
  const cheap = ramp(40, 1, 1.2);
  const dear = ramp(40, 1000, 1200);
  const { byKey } = plot([{ key: "cheap", samples: cheap }, { key: "dear", samples: dear }], 30, 6, WINDOW);
  expect(byKey.get("cheap")!.rows).toEqual(byKey.get("dear")!.rows);
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
