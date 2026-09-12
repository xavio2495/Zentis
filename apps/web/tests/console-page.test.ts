import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The console route's page, which is a bar and a terminal and nothing else.
 *
 * Everything a reader needs to know about what they are looking at, the console says itself: that
 * the moment is recorded, which keys exist, why the signing ones are disabled. A second header and
 * a footer around it repeat that in the page's voice, and the two voices then disagree the first
 * time one of them is edited.
 *
 * The mark is the landing's mark, drawn from the same path data the field samples. Pasting the
 * three paths here would be the second source of truth `docs/console-mock.html` already was once.
 */
const page = readFileSync(join(import.meta.dir, "..", "src", "app", "console", "page.tsx"), "utf8");

test("the page is one bar and the terminal", () => {
  expect(page).toContain("<Terminal");
  expect(page).not.toContain("<footer");
  // One header element, not a header plus a strip of links under it.
  expect([...page.matchAll(/<header/g)]).toHaveLength(1);
});

test("the mark comes from the geometry the landing draws, not from three pasted paths", () => {
  expect(page).toMatch(/from "@\/lib\/mark-geometry"/);
  expect(page).toContain("BRIDGE");
  expect(page).toContain("CHAIN_A");
  expect(page).toContain("CHAIN_B");
  // The literal path data lives in one file. If it is here too, one of them will be edited alone.
  expect(page).not.toMatch(/M594 257L663/);
});

test("the mark is drawn in the accent, which is what makes it the Zentis mark and not a glyph", () => {
  expect(page).toMatch(/accent/);
});
