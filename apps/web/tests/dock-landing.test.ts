import { describe, expect, test } from "bun:test";
import { dockPlacement } from "@/lib/dock";

/**
 * Where the install line is, and whether it is visible, as the page closes.
 *
 * Three attempts, and the first two are worth recording because each looked right in isolation.
 *
 * It first eased to `innerHeight / 2` — the middle of the viewport, which is the middle of the
 * closing section only if the reader stops scrolling at exactly the right place. At the foot of the
 * page they do not, so the line landed below the two buttons meant to sit under it.
 *
 * It then interpolated from the foot toward the section's gap, which put it at every position in
 * between — including, for a stretch of the scroll, directly on the "Try it out." heading.
 *
 * The obvious repair, `y = min(foot, gap)`, does not work either, and the arithmetic says why
 * before a screenshot does. The heading sits about 118px above the gap and the foot is about 698px
 * down a 758px viewport; while the gap is still below the foot the line holds at 698, and the
 * heading passes through 698 on its way up. The line does not have to move to be hit — the page
 * moves the heading into it.
 *
 * So the line is not in two places, it is in one place at a time: at the foot while the page is
 * still running, and in the gap once the section has arrived. In between it is not shown at all,
 * which is the only state in which nothing can overlap it.
 */
const VIEW = 758;
const FOOT = 698;
const place = (gapCentre: number | null, topEdge: number | null) =>
  dockPlacement({ footY: FOOT, viewportHeight: VIEW, gapCentre, topEdge });

describe("while the page is still running", () => {
  test("the line rides at the foot, fully visible", () => {
    expect(place(null, null)).toEqual({ y: FOOT, opacity: 1 });
  });

  test("it stays there while the closing section is still below the fold", () => {
    expect(place(VIEW + 240, VIEW + 120)).toEqual({ y: FOOT, opacity: 1 });
  });
});

describe("while the closing section is arriving", () => {
  test("the line goes out before the heading can reach it", () => {
    // The heading is on screen and the gap has not come down to the foot yet: the one interval in
    // which the two could collide, and the interval in which the line is not drawn.
    const { opacity } = place(FOOT + 200, VIEW - 60);
    expect(opacity).toBeLessThan(1);
  });

  test("it is completely gone by the time the heading reaches the foot", () => {
    expect(place(FOOT + 118, FOOT).opacity).toBe(0);
  });
});

describe("once the section has arrived", () => {
  test("the line is the gap, and visible again", () => {
    expect(place(300, 180)).toEqual({ y: 300, opacity: 1 });
  });

  test("it never sits above the gap it belongs to", () => {
    for (let gap = -100; gap <= VIEW + 400; gap += 29) {
      const { y, opacity } = place(gap, gap - 118);
      if (opacity === 0) continue;
      expect(y).toBeGreaterThanOrEqual(Math.min(FOOT, gap) - 0.001);
    }
  });

  test("the heading and the line are never both drawn at the same height", () => {
    // The property the whole design exists for, checked across the entire travel.
    for (let top = VIEW + 200; top > -400; top -= 7) {
      const gap = top + 118;
      const { y, opacity } = place(gap, top);
      if (opacity === 0) continue;
      expect(Math.abs(y - top)).toBeGreaterThan(40);
    }
  });
});

describe("nonsense", () => {
  test("is ignored rather than propagated into a transform", () => {
    expect(Number.isFinite(place(Number.NaN, Number.NaN).y)).toBe(true);
    expect(Number.isFinite(place(null, Number.NaN).y)).toBe(true);
  });
});
