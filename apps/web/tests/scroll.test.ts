import { afterEach, describe, expect, test } from "bun:test";
import { clearScrollSource, scrollNow, setScrollSource } from "../src/lib/scroll";

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
