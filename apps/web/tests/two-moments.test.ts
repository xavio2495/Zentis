import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Two moments on one screen, each saying which it is.
 *
 * The bar under the header follows the playhead: at the round it is replaying the shift reads +535.
 * The leg cards below show the recorded moment, where the same leg reads −272. Both are true and
 * both are labelled by sequence, but they sat on touching rows with nothing between them saying
 * they are different times — and a reader glancing at "+535" above "−272" concludes the screen
 * contradicts itself rather than that it is showing a film and a photograph at once.
 *
 * So each band says what it is, in words, before it says a number.
 */
const source = (...parts: string[]) => readFileSync(join(import.meta.dir, "..", "src", ...parts), "utf8");
const screen = source("components", "console", "Screen.tsx");
const card = source("components", "console", "LegCard.tsx");
const bookRow = source("components", "console", "BookRow.tsx");

test("the playhead's band says it is the replay, and which round", () => {
  expect(screen).toMatch(/replay/i);
  // The word and the sequence in the same label, or "replay" reads as the name of the page.
  expect(screen).toMatch(/replay[^"']*seq|seq[^"']*replay/i);
});

test("the book's band says it is the recorded moment, and which sequence", () => {
  // In the band's own component, where the sequence it belongs to is: the caption and the number
  // have to move together or they can drift apart in a later edit.
  expect(bookRow).toMatch(/recorded moment/i);
  expect(bookRow).toMatch(/seq \{/);
});

test("the two bands are separated rather than stacked flush", () => {
  // A rule between them: touching rows read as one table, which is the whole problem.
  const between = screen.slice(screen.indexOf("min-h-9"), screen.indexOf("<BookRow"));
  expect(between.length).toBeGreaterThan(0);
  expect(screen).toMatch(/border-line2|border-t-2|mt-|border-b-2/);
});

test("a leg card says the shift it draws is the recorded moment's, not the replay's", () => {
  // The card is where the −272 lives, and it is the number a reader compares against the bar.
  expect(card).toMatch(/recorded moment/i);
});
