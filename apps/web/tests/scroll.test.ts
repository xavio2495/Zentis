import { afterEach, describe, expect, test } from "bun:test";
import { clearScrollSource, clearScrollTo, scrollNow, scrollToTarget, setScrollSource, setScrollTo } from "../src/lib/scroll";

afterEach(() => clearScrollSource());

describe("scrollNow", () => {
  test("falls back to the window when nothing smooths the scroll", () => {
    (globalThis as { scrollY?: number }).scrollY = 412;
    expect(scrollNow()).toBe(412);
  });

  test("reports the smoothed position once there is one", () => {
    (globalThis as { scrollY?: number }).scrollY = 412;
    // the smoother lags the real scrollbar; anything drawn outside the smoothed
    // content has to follow the lagging value or it slides against the page
    setScrollSource(() => 380.5);
    expect(scrollNow()).toBe(380.5);
  });

  test("goes back to the window when the smoother is torn down", () => {
    (globalThis as { scrollY?: number }).scrollY = 7;
    setScrollSource(() => 999);
    clearScrollSource();
    expect(scrollNow()).toBe(7);
  });

  test("never returns something unusable if the source throws or drifts", () => {
    setScrollSource(() => Number.NaN);
    expect(Number.isFinite(scrollNow())).toBe(true);
  });
});

describe("scrollToTarget", () => {
  /**
   * Why this exists at all: ScrollSmoother makes `#smooth-wrapper` the visual viewport — fixed and
   * overflow-hidden — and drives the content by transform. A native anchor jump therefore tries to
   * scroll an ancestor that cannot scroll, and does nothing at all, so every link in the nav set
   * the hash and left the reader where they were. The smoother has to be asked directly.
   */
  afterEach(() => clearScrollTo());

  test("hands the target to the smoother when one is running", () => {
    const asked: unknown[] = [];
    setScrollTo((target) => {
      asked.push(target);
      return true;
    });
    expect(scrollToTarget("#position")).toBe(true);
    expect(asked).toEqual(["#position"]);
  });

  test("reports that it did not scroll when nothing is registered", () => {
    // The caller needs to know, because the fallback is its to perform: this module has no
    // business touching the window when the page may not be the thing that scrolls.
    expect(scrollToTarget("#position")).toBe(false);
  });

  test("a smoother that cannot find the target says so rather than claiming success", () => {
    setScrollTo(() => false);
    expect(scrollToTarget("#nowhere")).toBe(false);
  });

  test("a smoother that throws does not take the click down with it", () => {
    setScrollTo(() => {
      throw new Error("killed mid-navigation");
    });
    expect(scrollToTarget("#position")).toBe(false);
  });
});
