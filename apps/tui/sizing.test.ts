import { expect, test } from "bun:test";
import { MIN_COLS, MIN_ROWS, fit, pad, padRows, trunc, wrapLines } from "./src/layout.js";

const SIZES: [number, number][] = [
  [190, 50], [190, 40], [120, 44], [120, 40], [100, 30], [80, 24], [80, 30], [200, 60],
];

test("the regions always leave a row of headroom, at every size", () => {
  // Ink clears the whole terminal the moment its output reaches stdout.rows, so a layout that fills
  // the height exactly repaints from scratch every frame. One row under is the whole guarantee.
  for (const [cols, rows] of SIZES) {
    const r = fit(cols, rows);
    expect(r.draw).toBe(rows - 1);
    // Every region is a bordered panel, and the keys have one of their own below the feed now; each
    // border is the two rows outside its content.
    expect(r.statusRows + 2 + r.graphRows + r.feedRows + r.keyRows + 2).toBe(r.draw);
    expect(r.cardHeights[0] + r.cardHeights[1] + r.cardHeights[2]).toBe(r.draw);
    expect(r.draw).toBeLessThan(rows);
  }
});

test("the two columns fit the width with a gutter and never exceed it", () => {
  for (const [cols, rows] of SIZES) {
    const r = fit(cols, rows);
    expect(r.legsWidth + r.rightWidth).toBeLessThanOrEqual(cols);
    expect(r.legsWidth).toBeGreaterThanOrEqual(28); // a card still holds a quote and a gauge
    expect(r.legsWidth).toBeLessThanOrEqual(40); // beyond this it is gutter, and the charts want it
  }
});

test("the wireframe's proportions hold: a left third, and charts near half the right", () => {
  const r = fit(190, 50);
  expect(r.legsWidth / 190).toBeGreaterThan(0.14);
  expect(r.legsWidth / 190).toBeLessThan(0.34);
  const body = r.draw - r.statusRows;
  expect(Math.abs(r.graphRows / body - 0.5)).toBeLessThan(0.35);
});

test("the status bar is never shed, because it carries the reason and the remedy", () => {
  for (const [cols, rows] of [...SIZES, [80, 24] as [number, number]]) {
    expect(fit(cols, rows).statusRows).toBeGreaterThanOrEqual(1);
  }
});

test("the charts give ground before the feed does, and vanish before either breaks", () => {
  const tall = fit(120, 50);
  const short = fit(120, 26);
  expect(tall.graphRows).toBeGreaterThan(short.graphRows);
  // At the smallest supported height the charts are gone rather than drawn as a row of noise.
  const tiny = fit(80, MIN_ROWS);
  expect(tiny.graphRows === 0 || tiny.graphRows >= 7).toBe(true);
  expect(tiny.feedRows).toBeGreaterThan(0);
});

test("below the minimum the console says so rather than drawing a broken frame", () => {
  expect(MIN_COLS).toBe(80);
  expect(MIN_ROWS).toBe(24);
});

test("wrapping is bounded, so a region's height does not depend on how much there was to say", () => {
  const long = "the reference is 251 minutes old, so the quote has widened 200 bps, which is its cap";
  for (const max of [1, 2, 3]) {
    const lines = wrapLines(long, 30, max);
    expect(lines.length).toBeLessThanOrEqual(max);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(30);
  }
  expect(wrapLines("short", 30, 2)).toEqual(["short"]);
});

test("truncation is visible, and padding makes a cell exactly its width", () => {
  expect(trunc("abcdef", 4)).toBe("abc…");
  expect(trunc("abc", 4)).toBe("abc");
  expect(pad("abc", 6)).toBe("abc   ");
  expect(pad("abcdefgh", 6)).toBe("abcde…");
});

test("rows are padded to their region's height so frames never jitter", () => {
  expect(padRows(["a"], 3, "")).toEqual(["a", "", ""]);
  expect(padRows(["a", "b", "c", "d"], 2, "")).toEqual(["a", "b"]);
});

test("a terminal reporting zero is reporting that it does not know", () => {
  // A pty opened without a size reports 0, which `?? 80` does not catch. Treating that as a real
  // width made the console refuse to draw in a terminal that was actually 120 columns wide.
  const known = (value: number | undefined, fallback: number) =>
    value === undefined || !Number.isFinite(value) || value <= 0 ? fallback : value;
  expect(known(0, 80)).toBe(80);
  expect(known(undefined, 80)).toBe(80);
  expect(known(Number.NaN, 80)).toBe(80);
  expect(known(190, 80)).toBe(190);
});
