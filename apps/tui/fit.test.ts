import { expect, test } from "bun:test";
import { chooseFit, shiftRow, spreadRow } from "./src/format.js";

test("the widest rendering that fits is the one chosen", () => {
  expect(chooseFit(["a very long form", "medium form", "short"], 40)).toBe("a very long form");
  expect(chooseFit(["a very long form", "medium form", "short"], 12)).toBe("medium form");
  expect(chooseFit(["a very long form", "medium form", "short"], 6)).toBe("short");
});

test("when nothing fits, the shortest is cut rather than the caller left to overflow", () => {
  // Overflowing is the one option not on the table: Ink shortens an overlong row by deleting
  // characters from inside it, which on a row of numbers produces a smaller number that still looks
  // like a number. A visible cut is always better than a silent one.
  const cut = chooseFit(["longest", "shortest"], 4);
  expect(cut.length).toBeLessThanOrEqual(4);
  expect(cut.endsWith("…")).toBe(true);
});

test("the spread stack drops its explanation before it drops a digit", () => {
  const stack = { totalBps: 259, baseBps: 10, volatilityBps: 49, markoutBps: 0, stalenessBps: 200 };
  for (const width of [40, 30, 25, 22]) {
    const row = spreadRow(stack, 2, 252, width);
    expect((row.numbers + row.note).length).toBeLessThanOrEqual(width);
    expect(row.numbers).toContain("10+49+0+200"); // every term whole, at every width
  }
});

test("a spread stack too wide for its column loses the total's label, never its terms", () => {
  const stack = { totalBps: 610, baseBps: 200, volatilityBps: 200, markoutBps: 10, stalenessBps: 200 };
  const row = spreadRow(stack, 2, 252, 20);
  expect(row.numbers.length).toBeLessThanOrEqual(20);
  expect(row.numbers).toContain("200+200+10+200");
});

test("the shift row says the total is capped, so three numbers that do not add up are explained", () => {
  // -1631 + 1131 is -500 only because the cap intervened. Printed bare, the row reads as arithmetic
  // that does not work, which is worse than printing nothing.
  const wide = shiftRow(-500n, -1631n, 1131n, true, 60);
  expect(wide).toContain("capped");
  expect(wide).toContain("-1631");
  expect(wide).toContain("+1131");

  const uncapped = shiftRow(57n, 0n, 57n, false, 60);
  expect(uncapped).not.toContain("capped");
});

test("a narrow column keeps the shift and drops the split, never half a number", () => {
  const narrow = shiftRow(-500n, -1631n, 1131n, true, 16);
  expect(narrow.length).toBeLessThanOrEqual(16);
  expect(narrow).toContain("-500");
});
