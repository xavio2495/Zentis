import { beforeEach, describe, expect, test } from "bun:test";
import { clearDockTarget, dockY, setDockTarget } from "@/lib/dock";

/**
 * Where the install line sits as the page closes.
 *
 * Two attempts failed before this one, and both failed the same way: they computed the line's
 * position from something other than where it was going.
 *
 * First it eased to `innerHeight / 2`, the middle of the viewport — which is the middle of the
 * closing section only if the reader stops scrolling at exactly the right place. At the foot of the
 * page they do not, so the line landed below the two buttons meant to sit under it.
 *
 * Then it eased from the foot toward the section's gap, interpolating between the two. That put it
 * at every position in between — including, for a stretch of the scroll, exactly on top of the
 * "Try it out." heading, which sits above the gap. A line of monospace sitting on a serif heading.
 *
 * So it no longer interpolates at all. It waits at the foot until the gap it is going to has risen
 * to meet it, and from then on it *is* the gap. The invariant that follows is the one that matters:
 * the line is never above the gap, so it can never reach anything laid out above the gap.
 */
beforeEach(() => clearDockTarget());

const FOOT = 700;

describe("dockY", () => {
  test("waits at the foot while the section is still below the fold", () => {
    setDockTarget(1400);
    expect(dockY(FOOT, 758)).toBe(FOOT);
  });

  test("sits at the foot when no section has claimed it", () => {
    expect(dockY(FOOT, 758)).toBe(FOOT);
  });

  test("rides up with the gap once the gap has come to it", () => {
    setDockTarget(300);
    expect(dockY(FOOT, 758)).toBe(300);
  });

  test("meets the gap without a jump at the moment they coincide", () => {
    setDockTarget(FOOT);
    expect(dockY(FOOT, 758)).toBe(FOOT);
  });

  test("is never above the gap, which is what keeps it off the heading", () => {
    // The heading is laid out above the gap. If the line is never above the gap, it can never be
    // on the heading — at any scroll position, without knowing where the heading is.
    for (let gap = -200; gap <= 1600; gap += 37) {
      setDockTarget(gap);
      expect(dockY(FOOT, 758)).toBeGreaterThanOrEqual(Math.min(FOOT, clampForTest(gap, 758)));
      expect(dockY(FOOT, 758)).toBeLessThanOrEqual(Math.max(FOOT, clampForTest(gap, 758)));
    }
  });

  test("a gap scrolled off the top does not drag the line off with it", () => {
    setDockTarget(-400);
    expect(dockY(FOOT, 758)).toBeGreaterThan(0);
  });

  test("nonsense is ignored rather than propagated into a transform", () => {
    setDockTarget(Number.NaN);
    expect(Number.isFinite(dockY(FOOT, 758))).toBe(true);
  });
});

/** The same on-screen clamp the module applies, for the invariant above. */
const clampForTest = (y: number, viewportHeight: number) =>
  Math.max(viewportHeight * 0.18, Math.min(viewportHeight - viewportHeight * 0.18, y));
