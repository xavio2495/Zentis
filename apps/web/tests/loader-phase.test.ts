import { describe, expect, test } from "bun:test";
import { COUNT_MS, FADE_MS, loaderPhase, loaderProgress } from "../src/lib/loader-phase";

describe("loaderProgress", () => {
  test("starts at nothing and ends at all of it", () => {
    expect(loaderProgress(0)).toBe(0);
    expect(loaderProgress(COUNT_MS)).toBe(1);
    expect(loaderProgress(COUNT_MS * 3)).toBe(1);
  });

  test("decelerates rather than running at a constant rate", () => {
    expect(loaderProgress(COUNT_MS / 2)).toBeGreaterThan(0.5);
  });
});

describe("loaderPhase", () => {
  test("counts, then fades, then is gone", () => {
    expect(loaderPhase(0)).toBe("counting");
    expect(loaderPhase(COUNT_MS - 1)).toBe("counting");
    expect(loaderPhase(COUNT_MS)).toBe("fading");
    expect(loaderPhase(COUNT_MS + FADE_MS - 1)).toBe("fading");
  });

  test("has a terminal state, so the loader can actually leave the page", () => {
    // it is not enough to be transparent: an invisible layer still ghosts on
    // a compositor and still sits over everything at z-index 9999
    expect(loaderPhase(COUNT_MS + FADE_MS)).toBe("gone");
    expect(loaderPhase(COUNT_MS + FADE_MS + 10_000)).toBe("gone");
  });

  test("the fade is given long enough to finish before the layer is dropped", () => {
    expect(FADE_MS).toBeGreaterThanOrEqual(600);
  });
});
