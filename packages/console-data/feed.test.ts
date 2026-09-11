import { expect, test } from "bun:test";
import { LEGS } from "./src/config.js";
import { FEED_ROWS, type FeedRow, collapseFeed, foldRounds, mergeFeed, parseHistory } from "./src/fills.js";

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
  const rounds = rows(200).filter((r) => r.kind === "round");
  const seqs = rounds.map((r) => r.seq);
  expect(new Set(seqs).size).toBe(seqs.length);
});

/**
 * A publish written to three chains, with whatever else is asked for landing between the writes.
 *
 * Constructed rather than found in the recording. The case is about ordering — one decision, three
 * writes, seconds apart — and which publish in a recorded week happens to have a refusal wedged into
 * it changes with every re-record. Pinning a seq made an ordinary recording look like a bug.
 */
const publishAcross = (seq: number, at: number, options: { refusalBetween?: boolean } = {}) => {
  const legAt = (index: number, seconds: number) => ({
    kind: "reference" as const,
    chainId: LEGS[index]!.chainId,
    timestamp: BigInt(at + seconds),
    transaction: `0xref${seq}${index}`,
    mid: 10n ** 27n,
    tiltBps: -10,
    seq,
    updatedAt: BigInt(at),
  });
  const references = [legAt(0, 0), legAt(1, 8), legAt(2, 12)];
  const rejections = options.refusalBetween === true
    ? [
        {
          kind: "rejection" as const,
          chainId: LEGS[1]!.chainId,
          timestamp: BigInt(at + 4),
          transaction: `0xrej${seq}`,
          reason: "stale seq",
        },
      ]
    : [];
  return LEGS.map((leg, index) => ({
    position: null,
    fills: [],
    references: references.filter((r) => r.chainId === leg.chainId),
    rejections: rejections.filter((r) => r.chainId === leg.chainId),
  }));
};

test("one publish stays one row even when a refusal lands between its legs", () => {
  // Seen on 2026-09-11: a publish wrote three legs and two refusals landed between the first write
  // and the other two. Folding only a consecutive run split that publish into a row saying one leg
  // and a row saying two, so the screen showed two publishes where the enclave made one decision —
  // against a console whose whole claim is one mid and one book.
  const seq = 1789000000;
  const feed = collapseFeed(mergeFeed(publishAcross(seq, 1789000000, { refusalBetween: true }), 200), 200);
  const split = feed.filter((r) => r.kind === "round" && r.seq === seq);
  expect(split.length).toBe(1);
  expect(split[0]!.kind === "round" && split[0]!.legs.length).toBe(3);
});

test("a round is dated by its last leg to land, and says how long the writes took", () => {
  const at = 1789000000;
  const feed = collapseFeed(mergeFeed(publishAcross(1789000001, at), 200), 200);
  const round = feed.find((r) => r.kind === "round")!;
  // The last write is what makes the publish true everywhere, so that is when the round happened.
  expect(round.kind === "round" && round.timestamp).toBe(BigInt(at + 12));
  // A reader watching for one book should see that the legs are not written atomically, rather than
  // infer it from rows that disagree.
  expect(round.kind === "round" && round.spanSeconds).toBe(12);
});

test("the feed the operator sees surfaces the fill and the refusals the raw one buried", () => {
  // Collapsing three writes into one round is not enough on its own: the workflow publishes every
  // few minutes whether or not a shift moved, so after an hour of quiet the screen is thirteen
  // identical rounds and the fill is off the bottom. Built here with more quiet publishes than the
  // feed has rows, so the claim does not depend on how busy the recorded week happened to be.
  const at = 1789000000;
  const quiet = Array.from({ length: FEED_ROWS * 2 }, (_, i) => publishAcross(1789000100 + i, at + 600 + i * 300));
  const merged = LEGS.map((leg, index) => ({
    position: null,
    fills:
      index === 0
        ? [
            {
              kind: "fill" as const,
              chainId: leg.chainId,
              timestamp: BigInt(at),
              transaction: "0xfill",
              amountIn: 150_000n,
              amountOut: 40_000_000_000_000n,
              isAToB: true,
              hasReference: true,
              refMid: 10n ** 27n,
              refTiltBps: -10,
              refSeq: 1789000000,
              refAgeSeconds: 60n,
            },
          ]
        : [],
    references: quiet.flatMap((round) => round[index]!.references),
    rejections: [
      {
        kind: "rejection" as const,
        chainId: leg.chainId,
        timestamp: BigInt(at + 30),
        transaction: "0xrej",
        reason: "stale seq",
      },
    ],
  }));

  const shown = foldRounds(collapseFeed(mergeFeed(merged, 400), 400)).slice(0, FEED_ROWS);
  expect(shown.some((r) => r.kind === "fill")).toBe(true);
  expect(shown.some((r) => r.kind === "rejection")).toBe(true);
});
