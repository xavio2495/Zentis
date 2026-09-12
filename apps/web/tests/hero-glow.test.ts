import { describe, expect, test } from "bun:test";
import { letterGlow } from "../src/lib/hero-glow";

const band = { centerY: 400, halfHeight: 60 };
const letter = { centerX: 500, width: 40 };

describe("letterGlow", () => {
  test("is full under the cursor", () => {
    expect(letterGlow(500, 400, letter, band)).toBeCloseTo(1, 2);
  });

  test("falls away as the cursor moves along the word", () => {
    const near = letterGlow(520, 400, letter, band);
    const mid = letterGlow(560, 400, letter, band);
    const far = letterGlow(700, 400, letter, band);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(far).toBe(0);
  });

  test("is symmetric either side of the letter", () => {
    expect(letterGlow(460, 400, letter, band)).toBeCloseTo(
      letterGlow(540, 400, letter, band),
      6,
    );
  });

  test("holds while the cursor is anywhere over the word's own line", () => {
    expect(letterGlow(500, band.centerY - band.halfHeight + 2, letter, band)).toBeCloseTo(1, 2);
  });

  test("fades out as the cursor leaves the line, and dies well clear of it", () => {
    const close = letterGlow(500, band.centerY + band.halfHeight + 20, letter, band);
    const further = letterGlow(500, band.centerY + band.halfHeight + 50, letter, band);
    expect(close).toBeGreaterThan(0);
    expect(close).toBeLessThan(1);
    expect(further).toBeLessThan(close);
    expect(letterGlow(500, band.centerY + band.halfHeight * 3, letter, band)).toBe(0);
  });

  test("never leaves the zero-to-one range", () => {
    for (const x of [-500, 0, 499, 500, 501, 5000]) {
      for (const y of [-200, 0, 400, 900, 4000]) {
        const value = letterGlow(x, y, letter, band);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});
