import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The keyboard has to work without being told to.
 *
 * The console is a terminal in a page, and a terminal only receives keys when its hidden textarea
 * has focus. On load the focus is on the document body, so every key the console advertises — and it
 * advertises fourteen of them along the bottom of the screen — does nothing until the visitor
 * happens to click inside. There is no cue that a click is needed. A reader who presses `p`, sees
 * nothing, and concludes the page is a screenshot is the expected outcome, and I made exactly that
 * mistake myself while debugging this console.
 *
 * So the terminal takes focus when it mounts, takes it back when the page is clicked anywhere, and
 * the bar says the keys are live.
 */
const read = (...parts: string[]) => readFileSync(join(import.meta.dir, "..", "src", ...parts), "utf8");
const terminal = read("components", "console", "Terminal.tsx");
const page = read("app", "console", "page.tsx");

test("the terminal takes focus when it mounts, after it has been opened", () => {
  expect(terminal).toContain("term.focus()");
  // After `open`, not before: focusing a terminal that has no element yet does nothing at all.
  expect(terminal.indexOf("term.open(")).toBeLessThan(terminal.indexOf("term.focus()"));
});

test("a click anywhere on the page returns focus to the terminal", () => {
  // Clicking the bar, or the margin beside the terminal, moves focus out of it and silently kills
  // every key. The page is a terminal and a title; there is nowhere else focus usefully belongs.
  expect(terminal).toMatch(/addEventListener\("(pointerdown|mousedown|click)"/);
});

test("the page says the keys are live, so nobody has to discover it", () => {
  // A terminal in a page looks exactly like a picture of one. One line, in the bar, where a reader
  // looking for what to do next is already looking.
  expect(page).toMatch(/the keys are live/);
});
