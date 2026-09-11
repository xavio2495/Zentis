import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

/**
 * Where the mark is shown, and what it shares the screen with.
 *
 * Three screens have nothing else to say: the one waiting for a first poll, the one saying the
 * terminal is too small, and the one asking a stranger what kind of console they want. The logo goes
 * in the same place on each so that moving between them does not move it.
 */
const marked = (lines: string[]) => lines.filter((l) => /█/.test(l)).length;

test("the first frame is the mark, with what it is waiting for underneath", async () => {
  const frame = await drive(120, 40, { scenario: "loading" });
  expect(marked(frame.lines)).toBeGreaterThan(3);
  const text = frame.lines.join("\n");
  expect(text).toMatch(/reading the chains/);
  // The text sits below the mark, not beside it.
  const lastMark = frame.lines.findLastIndex((l) => /█/.test(l));
  const textAt = frame.lines.findIndex((l) => /reading the chains/.test(l));
  expect(textAt).toBeGreaterThan(lastMark);
  expect(frame.overflows).toBe(false);
}, 60_000);

test("a terminal too small to draw the console still gets the mark and the reason", async () => {
  const frame = await drive(60, 20, {});
  const text = frame.lines.join("\n");
  expect(text).toContain("at least 80×24");
  expect(marked(frame.lines)).toBeGreaterThan(3);
  expect(frame.overflows).toBe(false);
  expect(frame.width).toBeLessThanOrEqual(60);
}, 60_000);

test("onboarding keeps the mark where the loading screen had it, and asks underneath", async () => {
  const frame = await drive(120, 40, { onboarding: true });
  expect(marked(frame.lines)).toBeGreaterThan(3);
  const lastMark = frame.lines.findLastIndex((l) => /█/.test(l));
  const choiceAt = frame.lines.findIndex((l) => /make one here/.test(l));
  expect(choiceAt).toBeGreaterThan(lastMark);
  // The choices are in the lower half, which is what the mark leaves them.
  expect(choiceAt).toBeGreaterThan(frame.lines.length / 2 - 4);
  expect(frame.overflows).toBe(false);
}, 60_000);

test("the live view has no mark on it, because it has the book to show instead", async () => {
  const frame = await drive(120, 40, {});
  expect(marked(frame.lines)).toBe(0);
}, 60_000);
