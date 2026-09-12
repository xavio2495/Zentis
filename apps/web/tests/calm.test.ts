import { describe, expect, test } from "bun:test";
import { toNdcRect } from "../src/lib/calm";

const VIEWPORT = { width: 1000, height: 500 };

describe("toNdcRect", () => {
  test("puts a centred box at the origin", () => {
    const rect = toNdcRect({ left: 400, top: 200, width: 200, height: 100 }, VIEWPORT.width, VIEWPORT.height);
    expect(rect.x).toBeCloseTo(0, 6);
    expect(rect.y).toBeCloseTo(0, 6);
  });

  test("measures half-extents in the same units the shader compares against", () => {
    // y is normalised by half the viewport height; x is too, then corrected for
    // aspect, so a square on screen stays square in the comparison
    const rect = toNdcRect({ left: 400, top: 200, width: 200, height: 100 }, VIEWPORT.width, VIEWPORT.height);
    expect(rect.halfHeight).toBeCloseTo(100 / 500, 6);
    expect(rect.halfWidth).toBeCloseTo((200 / 500) * (VIEWPORT.width / VIEWPORT.height) / (VIEWPORT.width / VIEWPORT.height), 6);
  });

  test("flips y, because the screen counts down and the clip space counts up", () => {
    const high = toNdcRect({ left: 0, top: 0, width: 10, height: 10 }, VIEWPORT.width, VIEWPORT.height);
    const low = toNdcRect({ left: 0, top: 400, width: 10, height: 10 }, VIEWPORT.width, VIEWPORT.height);
    expect(high.y).toBeGreaterThan(low.y);
  });

  test("moves right as the box moves right", () => {
    const left = toNdcRect({ left: 0, top: 200, width: 100, height: 100 }, VIEWPORT.width, VIEWPORT.height);
    const right = toNdcRect({ left: 900, top: 200, width: 100, height: 100 }, VIEWPORT.width, VIEWPORT.height);
    expect(right.x).toBeGreaterThan(left.x);
    expect(left.x).toBeLessThan(0);
  });

  test("survives a zero-sized box without producing nonsense", () => {
    const rect = toNdcRect({ left: 0, top: 0, width: 0, height: 0 }, VIEWPORT.width, VIEWPORT.height);
    for (const value of [rect.x, rect.y, rect.halfWidth, rect.halfHeight]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
