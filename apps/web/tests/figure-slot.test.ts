import { describe, expect, test } from "bun:test";
import { markSlot, type FigureSide } from "@/lib/figure-slot";

/**
 * Where the mark stands relative to the figure on screen.
 *
 * The rule, and the first thing asserted, is that they are never on the same side. The page lays
 * its figures off-centre and alternating; the mark used to move to a fixed positive offset computed
 * for a *centred* text column, so on every right-hand figure the drawing and the mark ended up in
 * the same half with the whole left of the screen empty — and at 2000px the mark was half off the
 * right edge as well.
 *
 * So the mark takes the half the figure is not using, centred in it, and never leaves the viewport.
 */
const VIEWPORTS: [string, number, number][] = [
  ["phone", 390, 844],
  ["tablet", 1040, 780],
  ["laptop", 1478, 812],
  ["desktop", 2000, 1100],
];
const HALF_EXTENT = 140;

describe("the mark is never on the figure's side", () => {
  for (const [name, width, height] of VIEWPORTS) {
    for (const side of ["left", "right"] as FigureSide[]) {
      test(`${name}, figure ${side}: the mark is in the other half`, () => {
        const slot = markSlot({ side, viewportWidth: width, viewportHeight: height, halfExtentPx: HALF_EXTENT, figureCentreY: height / 2 });
        if (!slot.beside) return; // narrow screens stack instead; covered below
        if (side === "right") expect(slot.centreX).toBeLessThan(width / 2);
        else expect(slot.centreX).toBeGreaterThan(width / 2);
      });
    }
  }
});

describe("the mark stays on screen", () => {
  for (const [name, width, height] of VIEWPORTS) {
    test(`${name}: it is fully within the viewport, both edges`, () => {
      for (const side of ["left", "right"] as FigureSide[]) {
        const slot = markSlot({ side, viewportWidth: width, viewportHeight: height, halfExtentPx: HALF_EXTENT, figureCentreY: height / 2 });
        if (!slot.beside) continue;
        expect(slot.centreX - HALF_EXTENT).toBeGreaterThanOrEqual(0);
        expect(slot.centreX + HALF_EXTENT).toBeLessThanOrEqual(width);
      }
    });
  }

  test("a mark too wide for the free half is stood down rather than pushed off the edge", () => {
    // On a phone there is no half wide enough to hold it beside the words. Going dark is honest;
    // sliding off the side and bleeding back in is not.
    const slot = markSlot({ side: "right", viewportWidth: 390, viewportHeight: 844, halfExtentPx: 140, figureCentreY: 400 });
    expect(slot.beside).toBe(false);
  });
});

describe("the mark is level with the figure", () => {
  test("its centre follows the figure's centre", () => {
    const slot = markSlot({ side: "right", viewportWidth: 1478, viewportHeight: 812, halfExtentPx: 120, figureCentreY: 300 });
    expect(slot.centreY).toBe(300);
  });

  test("it is kept clear of the edges even when the figure is at one", () => {
    const high = markSlot({ side: "right", viewportWidth: 1478, viewportHeight: 812, halfExtentPx: 120, figureCentreY: -200 });
    expect(high.centreY).toBeGreaterThan(0);
    const low = markSlot({ side: "right", viewportWidth: 1478, viewportHeight: 812, halfExtentPx: 120, figureCentreY: 1400 });
    expect(low.centreY).toBeLessThan(812);
  });
});

describe("with no figure on screen", () => {
  test("the mark has no slot to take and says so", () => {
    expect(markSlot({ side: null, viewportWidth: 1478, viewportHeight: 812, halfExtentPx: 120, figureCentreY: 0 }).beside).toBe(false);
  });
});
