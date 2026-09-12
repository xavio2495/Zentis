import { expect, test } from "bun:test";
import { momentProblems } from "./src/moment.js";

const leg = (name: string, seq: number, indexedSeq: number | null) => ({
  name,
  history: {
    position: { id: "0x01" },
    references: indexedSeq === null ? [] : [{ seq: indexedSeq }, { seq: indexedSeq - 1 }],
  },
  ref: { seq },
});

test("three legs on one seq, each indexed up to it, is one moment", () => {
  expect(momentProblems([leg("a", 7, 7), leg("b", 7, 7), leg("c", 7, 7)], 3)).toEqual([]);
});

test("legs on different seqs are not one moment", () => {
  expect(momentProblems([leg("a", 7, 7), leg("b", 7, 7), leg("c", 6, 6)], 3).join()).toContain("different seqs");
});

test("a registry ahead of its fills subgraph is a moment the feed cannot show, and is named", () => {
  // Seen on the 21:56Z run: Arbitrum's registry, read over RPC, was at the new seq while its fills
  // subgraph had indexed only the one before, so the newest round held two legs and the check said OK.
  const problems = momentProblems([leg("sepolia", 9, 9), leg("base", 9, 9), leg("arbitrum", 9, 8)], 3);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("arbitrum");
  expect(problems[0]).toContain("indexed");
});

test("a history with no position is flagged against its leg", () => {
  const blank = { ...leg("base", 7, 7), history: { position: null, references: [{ seq: 7 }] } };
  expect(momentProblems([leg("a", 7, 7), blank, leg("c", 7, 7)], 3).join()).toContain("history-base");
});

/**
 * A slow round is a poor moment to record, and the recorder should say so before the fixtures are
 * used for a week.
 *
 * The slow workflow republishes the last fast round's tilt against a freshly budgeted boundary, so
 * the slot holds a tilt priced with one room beside a boundary that recovers a different one. The
 * console's recomputation then lands a few basis points away on every leg at once — which is the
 * one thing a recorded moment must not do, because reproducing the enclave's number is the claim
 * the whole surface exists to make.
 */
const carried = (name: string, seq: number, tiltBps: number) => ({
  name,
  history: {
    position: { id: "0x01" },
    // The round before published the same tilt: that is what a carry looks like from outside.
    references: [
      { seq, tiltBps },
      { seq: seq - 1, tiltBps },
    ],
  },
  ref: { seq, tiltBps },
});

test("a moment recorded on a carried round says so, because its shift cannot be reproduced", () => {
  const problems = momentProblems([carried("a", 9, -220), carried("b", 9, 257), carried("c", 9, 256)], 3);
  expect(problems.join()).toMatch(/carried/);
  expect(problems.join()).toMatch(/fast round/);
});

test("a round that recomputed is not a carry, whatever the seq before it did", () => {
  const fast = (name: string, seq: number, tiltBps: number) => ({
    ...carried(name, seq, tiltBps),
    history: {
      position: { id: "0x01" },
      references: [
        { seq, tiltBps },
        { seq: seq - 1, tiltBps: tiltBps + 3 },
      ],
    },
  });
  expect(momentProblems([fast("a", 9, -220), fast("b", 9, 257), fast("c", 9, 256)], 3)).toEqual([]);
});
