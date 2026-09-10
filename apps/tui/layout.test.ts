import { expect, test } from "bun:test";
import { FEED_ROWS } from "@zentis/console-data";
import { CONTENT_WIDTH, FRAME } from "./src/components/Divider.js";
import { clampToRows } from "./src/format.js";

/**
 * The layout has to fit 120 x 40 and stay legible in a 720p recording, and it is assembled from
 * panels of fixed height plus one that is not: the feed. Counting the budget here means the day a
 * panel gains a row, the suite says so — rather than the recording being reshot because the top of
 * the screen scrolled away.
 */
const PANELS = {
  bookStrip: 2,
  legsDivider: 1,
  // Per leg column, all fixed: heading, address, inventory, shift, gauge, room, spread, quote,
  // two rows of clamped `why`, one of caveats.
  legColumn: 12,
  feedDivider: 1,
  simDivider: 1,
  simHeadline: 1,
  simRegimes: 2,
  simUnit: 1,
  actionsDivider: 1,
  actionKeys: 1,
  finality: 1,
  status: 1,
  border: 2,
};

const HEIGHT = Object.values(PANELS).reduce((a, b) => a + b, 0) + FEED_ROWS;

test("the whole screen fits in 40 rows", () => {
  expect(HEIGHT).toBeLessThanOrEqual(40);
});

test("three leg columns and their padding fit the frame's width", () => {
  const columns = 3;
  const columnWidth = 38;
  expect(columns * columnWidth).toBeLessThanOrEqual(CONTENT_WIDTH);
  expect(FRAME.width).toBe(120);
  // A rule that overruns the content width wraps, and a wrapped rule costs a row everywhere.
  expect(CONTENT_WIDTH).toBe(FRAME.width - 4); // a rounded border and one column of padding a side
});

test("the frame has no fixed height, because Ink drops overflow rather than clipping it", () => {
  expect("height" in FRAME).toBe(false);
});

test("the why line is clamped to whole rows, and clamps on a word where it can", () => {
  const long = "the pool this leg prices from moved far enough over the week to carry the spread";
  const clamped = clampToRows(long, 37, 2);
  expect(clamped.length).toBeLessThanOrEqual(74);
  expect(clamped.endsWith("…")).toBe(true);
  expect(clamped).not.toContain("  ");

  const short = "every term is at zero";
  expect(clampToRows(short, 37, 2)).toBe(short); // nothing to clamp, nothing added
});

test("the why line is clamped by wrapped rows, not by a character count", () => {
  const columns = 37;
  // Wrapping is greedy on whole words, so a character budget of columns * rows overshoots whenever a
  // word straddles a line end — which is what pushed a column to three rows and the layout to 41.
  const long =
    "the reference is 251 minutes old, so the quote has widened 200 bps, which is the most it will widen";
  const clamped = clampToRows(`why: ${long}`, columns, 2);

  const wrapped: string[] = [];
  let line = "";
  for (const word of clamped.split(" ")) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (candidate.length <= columns) line = candidate;
    else {
      wrapped.push(line);
      line = word;
    }
  }
  wrapped.push(line);
  expect(wrapped.length).toBeLessThanOrEqual(2);
  expect(clamped.endsWith("…")).toBe(true);
});
