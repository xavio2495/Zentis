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
