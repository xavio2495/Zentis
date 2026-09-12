import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { step } from "@/lib/replay";

/**
 * The replay under a keyboard.
 *
 * Every control on the transport was pointer-only. A reader watching the shift move and wanting to
 * stop on the round where a fill lands has to find a twelve-pixel handle and drag it, and a reader
 * who cannot use a mouse has nothing at all. Space, the arrows, home and end are what anybody tries
 * first, and they cost one listener.
 *
 * `step` is the arithmetic on its own, so what a key does can be tested without a browser.
 */
const source = (...parts: string[]) => readFileSync(join(import.meta.dir, "..", "src", ...parts), "utf8");

test("an arrow moves one round, shift moves ten, and neither runs off either end", () => {
  expect(step(10, "right", false, 400)).toBe(11);
  expect(step(10, "left", false, 400)).toBe(9);
  expect(step(10, "right", true, 400)).toBe(20);
  expect(step(10, "left", true, 400)).toBe(0);
  // The ends hold rather than wrapping: a replay that jumps from the last round to the first under
  // a reader's hand takes the answer away from them.
  expect(step(399, "right", true, 400)).toBe(399);
  expect(step(0, "left", false, 400)).toBe(0);
  // Home and end are the ends themselves.
  expect(step(123, "home", false, 400)).toBe(0);
  expect(step(123, "end", false, 400)).toBe(399);
});

test("an empty replay has nowhere to step to", () => {
  expect(step(0, "right", false, 0)).toBe(0);
  expect(step(0, "end", false, 0)).toBe(0);
});

test("the transport listens for the keys a reader tries first", () => {
  const store = source("lib", "store.tsx");
  expect(store).toMatch(/addEventListener\("keydown"/);
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) expect(store).toContain(key);
  // Space plays and pauses, and the page must not also scroll on it.
  expect(store).toMatch(/" "|Space/);
  expect(store).toContain("preventDefault");
});

test("typing somewhere is not scrubbing: a field keeps its own keys", () => {
  // The scrub handle is an input. Space on it would otherwise both drag the handle and toggle play.
  expect(source("lib", "store.tsx")).toMatch(/INPUT|isContentEditable|tagName/);
});

test("every control on the transport is a button, so tab reaches all of them", () => {
  const transport = source("components", "console", "Transport.tsx");
  // The chips are buttons already; the assertion is that nothing here invents a clickable span.
  expect(transport).not.toMatch(/<span[^>]*onClick/);
  expect(source("components", "console", "ui.tsx")).toContain("<button");
});
