import { expect, test } from "bun:test";
import { LEGS } from "./src/config.js";
import { FEED_ROWS, type FeedRow, collapseFeed, mergeFeed, parseHistory } from "./src/fills.js";

import historySepolia from "./fixtures/history-sepolia.json" with { type: "json" };
import historyArbitrum from "./fixtures/history-arbitrum-sepolia.json" with { type: "json" };
import historyBase from "./fixtures/history-base-sepolia.json" with { type: "json" };

const histories = [
  parseHistory(LEGS[0]!.chainId, historySepolia as never),
  parseHistory(LEGS[1]!.chainId, historyArbitrum as never),
  parseHistory(LEGS[2]!.chainId, historyBase as never),
];

const rows = (limit: number): FeedRow[] => collapseFeed(mergeFeed(histories, 200), limit);

test("one reference across three chains is one row, not three", () => {
  const rounds = rows(40).filter((r) => r.kind === "round");
  expect(rounds.length).toBeGreaterThan(0);
  const newest = rounds[0]!;
  // The seq is the claim. Three rows repeating it would spend the feed restating the header, and
  // would hide the fills and refusals that are the only things on this screen that changed.
  expect(newest.legs.length).toBe(3);
  expect(new Set(newest.legs.map((l) => l.chainId)).size).toBe(3);
});

test("collapsing does not merge two different references", () => {
  const rounds = rows(40).filter((r) => r.kind === "round");
  const seqs = rounds.map((r) => r.seq);
  expect(new Set(seqs).size).toBe(seqs.length);
});

test("the collapsed feed surfaces the fill and the refusals the raw one buried", () => {
  const shown = rows(FEED_ROWS);
  expect(shown.some((r) => r.kind === "fill")).toBe(true);
  expect(shown.some((r) => r.kind === "rejection")).toBe(true);
});

test("a refusal is never collapsed, and keeps the registry's own words", () => {
  const rejections = rows(200).filter((r) => r.kind === "rejection");
  expect(rejections.length).toBeGreaterThan(0);
  expect(rejections.some((r) => r.reason === "stale seq")).toBe(true);
});

test("the collapsed feed stays in time order, newest first", () => {
  const shown = rows(40);
  for (let i = 1; i < shown.length; i += 1) {
    expect(shown[i - 1]!.timestamp >= shown[i]!.timestamp).toBe(true);
  }
});

test("a round records what each leg's shift became, so a reference row says what changed", () => {
  const newest = rows(40).find((r) => r.kind === "round")!;
  for (const leg of newest.legs) {
    expect(typeof leg.tiltBps).toBe("number");
  }
  expect(newest.legs.map((l) => l.tiltBps)).toContain(129);
});

test("a collapsed round says how many writes it folded in", () => {
  const newest = rows(40).find((r) => r.kind === "round")!;
  expect(newest.count).toBe(newest.legs.length);
  expect(newest.count).toBeGreaterThan(1);
});
