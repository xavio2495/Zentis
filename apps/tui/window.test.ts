import { expect, test } from "bun:test";
import { WINDOWS, autoWindow } from "./src/window.js";

const HOUR = 3_600;
const now = 1_000_000;

test("the chart defaults to the shortest window that still contains the leg's last fill", () => {
  // The beat is a fill, then a publish, then the other legs not moving. Over seven days the last
  // hour is one column and every publish in it collapses into a single tick at the right edge.
  expect(autoWindow(now - 20 * 60, now)).toBe(WINDOWS[0]!); // a fill 20 minutes ago: 1h
  expect(autoWindow(now - 5 * HOUR, now)).toBe(WINDOWS[1]!); // five hours ago: 24h
  expect(autoWindow(now - 3 * 24 * HOUR, now)).toBe(WINDOWS[2]!); // three days: 7d
});

test("with no fill in reach, the chart shows the longest window rather than an empty short one", () => {
  expect(autoWindow(null, now)).toBe(WINDOWS[2]!);
  expect(autoWindow(now - 30 * 24 * HOUR, now)).toBe(WINDOWS[2]!);
});

test("the windows are an hour, a day and the week the volatility term measures", () => {
  expect(WINDOWS.map((w) => w.seconds)).toEqual([HOUR, 24 * HOUR, 7 * 24 * HOUR]);
  expect(WINDOWS.map((w) => w.label)).toEqual(["1h", "24h", "7d"]);
});
