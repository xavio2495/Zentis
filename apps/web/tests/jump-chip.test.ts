import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { highlightIndex } from "@/lib/replay";

/**
 * The jump, which is the control this screen exists to have.
 *
 * A judge with thirty seconds should not have to drag a handle hunting for the moment worth seeing.
 * The chip did that — and then it went dead: it jumped to the first round that hit the cap, and the
 * recording that ships has none, because the reference cutover that produced them aged out of the
 * window when the moment was re-recorded. A disabled control reads as a broken page rather than a
 * quiet one.
 *
 * So the seed names the round and says why, and the chip reads both: where to go, and what a reader
 * is about to look at when they get there.
 */
const source = (...parts: string[]) => readFileSync(join(import.meta.dir, "..", "src", ...parts), "utf8");
const rounds = [
  { seq: 10, atSeconds: 100, tiltBps: 1, mid: "1", referenceChanged: false },
  { seq: 11, atSeconds: 160, tiltBps: 2, mid: "1", referenceChanged: false },
  { seq: 12, atSeconds: 220, tiltBps: 3, mid: "1", referenceChanged: false },
];

test("the highlight is found by its sequence, not by its position", () => {
  // Position would be wrong the moment a leg misses a round: the legs share a sequence, not an
  // index, and the spine is whichever leg published most.
  expect(highlightIndex(rounds, { seq: 11, atSeconds: 160, kind: "capped", why: "" })).toBe(1);
  expect(highlightIndex(rounds, { seq: 10, atSeconds: 100, kind: "capped", why: "" })).toBe(0);
});

test("a highlight the recording does not hold is no jump at all, rather than a jump to round zero", () => {
  expect(highlightIndex(rounds, { seq: 999, atSeconds: 1, kind: "capped", why: "" })).toBeNull();
  expect(highlightIndex(rounds, null)).toBeNull();
  expect(highlightIndex([], { seq: 10, atSeconds: 100, kind: "capped", why: "" })).toBeNull();
});

test("the transport jumps to the seed's highlight rather than hunting for a clamp", () => {
  const store = source("lib", "store.tsx");
  expect(store).toContain("jumpToHighlight");
  expect(store).toContain("highlightIndex");
  const transport = source("components", "console", "Transport.tsx");
  expect(transport).toContain("jumpToHighlight");
});

test("the chip says what it jumps to, in the seed's own words", () => {
  const transport = source("components", "console", "Transport.tsx");
  // The reason travels with the round: the chip's tooltip is the sentence the seed wrote, not a
  // label this component invented.
  expect(transport).toMatch(/highlight[^\n]*\.why|\.why/);
});

test("the marker on the rail stands where the jump lands", () => {
  const transport = source("components", "console", "Transport.tsx");
  expect(transport).not.toContain("firstClamp");
});
