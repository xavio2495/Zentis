import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The one round worth jumping to.
 *
 * The replay's jump chip exists for a reader with thirty seconds, and it was dead: it jumped to the
 * first round that hit the cap, and the recording that ships has no such round — the reference
 * cutover that produced them aged out of the window when the moment was re-recorded. A control that
 * does nothing is worse than no control, because it reads as a broken page rather than a quiet one.
 *
 * So the seed names the round itself, in precedence order, and says why in words. What is asserted
 * here is the precedence rather than today's answer: which round is most interesting depends on
 * what the recording caught, and a test pinned to one of them fails on the next recording for no
 * reason worth anybody's morning.
 */
interface Round { seq: number; atSeconds: number; tiltBps: number; mid: string; referenceChanged: boolean }
interface Leg { name: string; rounds: Round[]; decomposition: { cappedByRoom: boolean; tiltBps: string } }
interface Seeded {
  highlight: { seq: number; atSeconds: number; why: string; kind: string } | null;
  legs: Leg[];
}
const replay = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "public", "seed", "replay.json"), "utf8"),
) as Seeded;

test("the seed names a round to jump to, with the time and the reason", () => {
  expect(replay.highlight).not.toBeNull();
  const { seq, atSeconds, why, kind } = replay.highlight!;
  expect(seq).toBeGreaterThan(0);
  expect(atSeconds).toBeGreaterThan(0);
  // A sentence, not a label: the chip's tooltip and the panel's legend both read from this.
  expect(why.length).toBeGreaterThan(20);
  expect(["reference-change", "capped", "largest-shift"]).toContain(kind);
});

test("the round it names is one the recording actually holds", () => {
  const seqs = new Set(replay.legs.flatMap((leg) => leg.rounds.map((round) => round.seq)));
  expect(seqs.has(replay.highlight!.seq)).toBe(true);
  const at = new Set(replay.legs.flatMap((leg) => leg.rounds.filter((r) => r.seq === replay.highlight!.seq).map((r) => r.atSeconds)));
  expect(at.has(replay.highlight!.atSeconds)).toBe(true);
});

test("a reference change outranks everything, because it is the one round that is not a market move", () => {
  const changed = replay.legs.flatMap((leg) => leg.rounds.filter((round) => round.referenceChanged));
  if (changed.length === 0) {
    expect(replay.highlight!.kind).not.toBe("reference-change");
    return;
  }
  expect(replay.highlight!.kind).toBe("reference-change");
  expect(replay.highlight!.seq).toBe(Math.min(...changed.map((round) => round.seq)));
});

test("with no reference change and nothing capped, it is the largest shift in the recording", () => {
  if (replay.highlight!.kind !== "largest-shift") return;
  const deepest = Math.max(
    ...replay.legs.flatMap((leg) => leg.rounds.map((round) => Math.abs(round.tiltBps))),
  );
  const named = replay.legs.flatMap((leg) => leg.rounds.filter((round) => round.seq === replay.highlight!.seq));
  expect(Math.max(...named.map((round) => Math.abs(round.tiltBps)))).toBe(deepest);
});

test("the reason says what kind of round it is, in the words the screen can print", () => {
  const why = replay.highlight!.why;
  const expected: Record<string, RegExp> = {
    "reference-change": /reference/i,
    capped: /room|cap/i,
    "largest-shift": /shift|bps/i,
  };
  expect(why).toMatch(expected[replay.highlight!.kind]!);
});
