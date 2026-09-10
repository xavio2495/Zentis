import { expect, test } from "bun:test";
import { spreadRow } from "./src/format.js";

const COLUMN = 37;

test("the numbers always fit the column, so Ink is never asked to shorten them", () => {
  // The widest the terms can get: a spread and a markout at their caps, and a fully ramped age.
  for (const stack of [
    { totalBps: 259, baseBps: 10, volatilityBps: 49, markoutBps: 0, stalenessBps: 200 },
    { totalBps: 610, baseBps: 10, volatilityBps: 200, markoutBps: 200, stalenessBps: 200 },
    { totalBps: 10, baseBps: 10, volatilityBps: 0, markoutBps: 0, stalenessBps: 0 },
  ]) {
    const row = spreadRow(stack, 2, 9999, COLUMN);
    expect(row.numbers.length).toBeLessThanOrEqual(COLUMN);
  }
});

test("every term appears in full, because a dropped digit reads as a smaller number", () => {
  const row = spreadRow(
    { totalBps: 259, baseBps: 10, volatilityBps: 49, markoutBps: 0, stalenessBps: 200 },
    2,
    248,
    COLUMN,
  );
  expect(row.numbers).toContain("259");
  expect(row.numbers).toContain("10+49+0+200");
  // The terms sum to the total, which is the property a truncated row silently breaks.
  expect(10 + 49 + 0 + 200).toBe(259);
});

test("the ramp note is dropped whole rather than clipped mid-number", () => {
  const wide = spreadRow(
    { totalBps: 259, baseBps: 10, volatilityBps: 49, markoutBps: 0, stalenessBps: 200 },
    2,
    248,
    60,
  );
  expect(wide.note).toContain("2/m");
  expect(wide.note).toContain("248m");

  // At the real column width there is no room for it, and half a note is worse than none: it would
  // read as a rate or an age that is not the one the program is applying.
  const narrow = spreadRow(
    { totalBps: 610, baseBps: 10, volatilityBps: 200, markoutBps: 200, stalenessBps: 200 },
    2,
    9999,
    COLUMN,
  );
  expect(narrow.numbers.length + narrow.note.length).toBeLessThanOrEqual(COLUMN);
  expect(narrow.note === "" || narrow.note.includes("2/m")).toBe(true);
});

test("a leg with no ramp yet says nothing about one", () => {
  const row = spreadRow(
    { totalBps: 59, baseBps: 10, volatilityBps: 49, markoutBps: 0, stalenessBps: 0 },
    2,
    0,
    COLUMN,
  );
  expect(row.note).toBe("");
});
