import { expect, test } from "bun:test";
import { amount, clock, signed, since, stackedGauge, weightBar, weiish } from "./src/format.js";

const ONE = 10n ** 18n;
const text = (spans: ReturnType<typeof stackedGauge>) => spans.map((s) => s.text).join("");
const cellsOf = (spans: ReturnType<typeof stackedGauge>, term: string) =>
  spans.filter((s) => s.term === term).reduce((n, s) => n + s.text.length, 0);

test("a raw amount is printed at its own token's decimals, grouped, without rounding up", () => {
  expect(amount(150_000n, 6)).toBe("0.15");
  expect(amount(15_000_000n, 6)).toBe("15");
  expect(amount(1_234_567_890n, 6)).toBe("1,234.5678");
  expect(amount(-150_000n, 6)).toBe("-0.15");
  expect(amount(0n, 6)).toBe("0");
});

test("an eighteen-decimal amount is printed in exponent form, where the decimal form is all zeroes", () => {
  expect(weiish(3_882_474_794_738n, 18)).toBe("3.88e12");
  expect(weiish(0n, 18)).toBe("0");
  expect(weiish(150_000n, 6)).toBe("0.15");
});

test("a tilt always carries its sign, because an unsigned one reads as a magnitude", () => {
  expect(signed(129)).toBe("+129");
  expect(signed(-5n)).toBe("-5");
  expect(signed(0)).toBe("0");
});

test("an age is said the way an operator says it", () => {
  expect(since(45)).toBe("45s");
  expect(since(60)).toBe("1m");
  expect(since(16 * 60)).toBe("16m");
  expect(since(3 * 3600 + 120)).toBe("3h2m");
});

test("the inventory bar marks the even split, whatever the weight", () => {
  const even = weightBar(ONE / 2n, 12);
  expect(even.length).toBe(12);
  expect(even[6]).toBe("│");
  expect(weightBar(0n, 12)[6]).toBe("│");
  expect(weightBar(ONE, 12)[6]).toBe("│");
});

test("the gauge's run is the whole shift, on the side the shift's sign puts it", () => {
  const width = 20;
  const negative = stackedGauge(0n, -500n, 500n, width);
  const positive = stackedGauge(500n, 0n, 500n, width);
  expect(text(negative).length).toBe(width);
  expect(text(positive).length).toBe(width);
  // A shift at the cap fills its half and leaves the other half empty.
  expect(text(negative).slice(0, 10)).toBe("█".repeat(10));
  expect(text(positive).slice(10)).toBe("█".repeat(10));
});

test("the terms take the share of the run their magnitudes earn, on either side of zero", () => {
  // Base's live state: the whole shift is correction, because the boundary left no room to concede.
  const allCorrection = stackedGauge(129n, 0n, 500n, 20);
  expect(cellsOf(allCorrection, "concession")).toBe(0);
  expect(cellsOf(allCorrection, "correction")).toBeGreaterThan(0);

  // Sepolia's: no correction at an even split, so the whole shift is concession.
  const allConcession = stackedGauge(0n, -5n, 500n, 20);
  expect(cellsOf(allConcession, "correction")).toBe(0);

  // A half-and-half shift splits its cells evenly whichever way it points, and the colour follows
  // the term rather than the position: this is what a negative run reverses.
  for (const sign of [1n, -1n]) {
    const split = stackedGauge(sign * 200n, sign * 200n, 400n, 20);
    expect(cellsOf(split, "correction")).toBe(5);
    expect(cellsOf(split, "concession")).toBe(5);
  }
});

test("the correction is the term nearest zero, so the two runs stack outward", () => {
  const width = 20;
  const positive = stackedGauge(400n, 400n, 800n, width);
  const negative = stackedGauge(-400n, -400n, 800n, width);
  // Positive grows rightward from cell 10, so the correction occupies the cells just right of it.
  expect(positive.findIndex((s) => s.term === "correction")).toBe(1);
  // Negative grows leftward, so reading left to right the concession comes first.
  expect(negative.findIndex((s) => s.term === "concession")).toBe(1);
  expect(negative.findIndex((s) => s.term === "correction")).toBe(2);
});

test("a zero shift draws no run at all", () => {
  const spans = stackedGauge(0n, 0n, 500n, 20);
  expect(text(spans)).toBe("░".repeat(20));
});

test("a clock reading is the block's own time, to the second", () => {
  expect(clock(1789029519n)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
});
