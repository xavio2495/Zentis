import { beforeEach, describe, expect, test } from "bun:test";
import { clearDockTarget, dockLandingY, setDockTarget } from "@/lib/dock";

/**
 * Where the install line comes to rest as the page closes.
 *
 * It used to ease to `innerHeight / 2` — the middle of the *viewport*, which is only the middle of
 * the closing section if the reader happens to stop scrolling at exactly the right place. At the
 * foot of the page they do not: the section has scrolled up, so the line landed below the two
 * buttons meant to sit under it and the title had left the screen entirely.
 *
 * So the section says where the line should land, and the line goes there.
 */
beforeEach(() => clearDockTarget());

describe("dockLandingY", () => {
  test("falls back to the middle of the viewport when the section has not said", () => {
    // Before the closing section mounts, or on a page that has none at all.
    expect(dockLandingY(800)).toBe(400);
  });

  test("lands where the section asked once it has", () => {
    setDockTarget(612);
    expect(dockLandingY(800)).toBe(612);
  });

  test("a target scrolled off the top does not drag the line off with it", () => {
    // The room is above the viewport: the line stays on screen rather than following it away.
    setDockTarget(-300);
    expect(dockLandingY(800)).toBeGreaterThan(0);
  });

  test("a target below the fold is pulled back to somewhere readable", () => {
    setDockTarget(4000);
    expect(dockLandingY(800)).toBeLessThan(800);
  });

  test("a target that stops being published goes back to the viewport", () => {
    setDockTarget(612);
    clearDockTarget();
    expect(dockLandingY(800)).toBe(400);
  });

  test("nonsense is ignored rather than propagated into a transform", () => {
    setDockTarget(Number.NaN);
    expect(Number.isFinite(dockLandingY(800))).toBe(true);
  });
});
