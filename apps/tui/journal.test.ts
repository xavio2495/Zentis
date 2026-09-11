import { expect, test } from "bun:test";
import { KEPT, hashesIn, record, settle } from "./src/journal.js";

/**
 * What the console did, kept so it can be looked at afterwards.
 *
 * The status bar says what the last action answered and then the next one replaces it, which is
 * fine while watching and useless afterwards: an operator who filled twice and wants the second
 * transaction has nowhere to look. The log is that place, and it is two columns because there are
 * two things to know — what was asked for, and what went on chain because of it.
 *
 * Nothing here reads a chain. An entry is written when the console asks for something and finished
 * when the child answers, so the log is a record of this console's own actions rather than a second,
 * worse copy of the feed.
 */
const at = 1_789_000_000;

test("an action is written down when it is asked for and finished when it answers", () => {
  const asked = record([], { id: 1, atSeconds: at, source: "key", action: "fill Sepolia 0.15 USDC" });
  expect(asked[0]!.outcome).toBeNull();
  expect(asked[0]!.hashes).toEqual([]);

  const hash = "0x227404a1d0d0f1f45ae4b2e05eaf7f4b1ea72c0c47c7dd36ee9a71bc8b9b7f2c";
  const done = settle(asked, 1, `fill Sepolia finished ${hash} — watch the feed`, false);
  expect(done[0]!.outcome).toContain("finished");
  expect(done[0]!.hashes).toEqual([hash]);
  expect(done[0]!.bad).toBe(false);
  // The action it was asked as is not rewritten by what it answered.
  expect(done[0]!.action).toBe("fill Sepolia 0.15 USDC");
});

test("the newest is first, and the console does not grow forever", () => {
  let log = record([], { id: 0, atSeconds: at, source: "key", action: "first" });
  for (let i = 1; i <= KEPT + 5; i += 1) {
    log = record(log, { id: i, atSeconds: at + i, source: "key", action: `action ${i}` });
  }
  expect(log).toHaveLength(KEPT);
  expect(log[0]!.action).toBe(`action ${KEPT + 5}`);
  expect(log.some((e) => e.action === "first")).toBe(false);
});

test("an address is not a transaction, and neither is a word that happens to be long", () => {
  const address = "0x4887B4695dEe830A341304bFEb14538E2442DD55";
  expect(hashesIn(`address ${address}`)).toEqual([]);
  const two = [
    "0x227404a1d0d0f1f45ae4b2e05eaf7f4b1ea72c0c47c7dd36ee9a71bc8b9b7f2c",
    "0x9b1f0d5c7e3a2b48c6d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5",
  ];
  expect(hashesIn(`approved ${two[0]} success · filled ${two[1]} success`)).toEqual(two);
});

test("a settled entry that failed says so, because a log of only the good half is a worse log", () => {
  const asked = record([], { id: 7, atSeconds: at, source: "command", action: "push Base 1 WETH" });
  const done = settle(asked, 7, "push Base exited 1: insufficient funds", true);
  expect(done[0]!.bad).toBe(true);
  expect(done[0]!.outcome).toContain("insufficient funds");
});
