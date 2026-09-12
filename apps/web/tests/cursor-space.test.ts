import { describe, expect, test } from "bun:test";
import { cursorInMarkSpace } from "../src/lib/cursor-space";

describe("cursorInMarkSpace", () => {
  test("is at the origin when the mark sits under the cursor", () => {
    // the mark's own offset is the cursor's position carried to its depth, so
    // the two have to be compared at that same depth
    const depthRatio = 3.125;
    const pointer = { x: 2, y: -1 };
    const group = { x: pointer.x * depthRatio, y: pointer.y * depthRatio };
    const local = cursorInMarkSpace(pointer.x, pointer.y, depthRatio, group.x, group.y, 1);
    expect(local.x).toBeCloseTo(0, 6);
    expect(local.y).toBeCloseTo(0, 6);
  });

  test("carries the cursor to the mark's depth before comparing", () => {
    // at three times the depth a world unit covers a third of the screen, so
    // the cursor is three times further out in the mark's own space
    const near = cursorInMarkSpace(2, 0, 1, 0, 0, 1);
    const far = cursorInMarkSpace(2, 0, 3, 0, 0, 1);
    expect(far.x).toBeCloseTo(near.x * 3, 6);
  });

  test("measures in the mark's units, not the world's", () => {
    const full = cursorInMarkSpace(2, 0, 1, 0, 0, 1);
    const half = cursorInMarkSpace(2, 0, 1, 0, 0, 0.5);
    expect(half.x).toBeCloseTo(full.x * 2, 6);
  });

  test("survives a mark scaled to nothing", () => {
    const local = cursorInMarkSpace(1, 1, 1, 0, 0, 0);
    expect(Number.isFinite(local.x)).toBe(true);
    expect(Number.isFinite(local.y)).toBe(true);
  });
});
