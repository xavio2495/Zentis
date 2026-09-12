import { describe, expect, test } from "bun:test";
import { dockClearance, type Band } from "@/lib/dock";

/**
 * Whether the install line may be drawn where it currently is.
 *
 * The line is fixed near the foot of the viewport, and the page scrolls content up through that
 * band all the way down. Keeping it off the closing section's heading fixed one collision by
 * knowing about one element; it did nothing for the four diagrams, and the line was drawn across
 * the spread figure's rows and the no-bridge figure's node labels on the way past.
 *
 * So it is the same rule the mark already follows: content declares the room it needs, and anything
 * floating over the page gets out of the way of all of it, rather than of the one thing somebody
 * remembered. A diagram added next week is covered without touching this file.
 */
const band = (top: number, bottom: number): Band => ({ top, bottom });

describe("dockClearance", () => {
  test("is clear when nothing is near", () => {
    expect(dockClearance(band(700, 730), [band(100, 300), band(340, 520)])).toBe(1);
  });

  test("is nothing at all when content is squarely in the band", () => {
    expect(dockClearance(band(700, 730), [band(680, 760)])).toBe(0);
  });

  test("is nothing when the band is inside a tall figure", () => {
    expect(dockClearance(band(700, 730), [band(200, 900)])).toBe(0);
  });

  test("fades rather than blinking as content approaches", () => {
    // A line that vanishes the instant a caption touches it reads as a glitch; one that dims as the
    // figure arrives reads as deference.
    const approaching = dockClearance(band(700, 730), [band(770, 900)]);
    expect(approaching).toBeGreaterThan(0);
    expect(approaching).toBeLessThan(1);
  });

  test("takes the worst of several, not the average", () => {
    // One clear figure does not license drawing over another.
    expect(dockClearance(band(700, 730), [band(100, 200), band(690, 750)])).toBe(0);
  });

  test("an empty page leaves it drawn", () => {
    expect(dockClearance(band(700, 730), [])).toBe(1);
  });

  test("nothing is ever drawn over content, at any point of a full travel", () => {
    // The property, walked rather than sampled: a figure scrolled from below the fold to above it,
    // and at no height where the two overlap is the line visible.
    const line = band(700, 730);
    for (let top = 1000; top > -400; top -= 3) {
      const figure = band(top, top + 260);
      const opacity = dockClearance(line, [figure]);
      const overlaps = figure.top < line.bottom && figure.bottom > line.top;
      if (overlaps) expect(opacity).toBe(0);
    }
  });
});
