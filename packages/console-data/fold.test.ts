import { expect, test } from "bun:test";
import { type FeedRound, type FeedRow, foldRounds, referenceChanges } from "./src/fills.js";

const round = (timestamp: bigint, seq: number, tilts: [number, number][]): FeedRow => ({
  kind: "round",
  timestamp,
  seq,
  count: tilts.length,
  spanSeconds: 0,
  legs: tilts.map(([chainId, tiltBps]) => ({ chainId, tiltBps, mid: 1n, transaction: "0x" })),
});
const fill: FeedRow = {
  kind: "fill",
  chainId: 1,
  timestamp: 500n,
  transaction: "0xf",
  amountIn: 1n,
  amountOut: 1n,
  isAToB: true,
  hasReference: true,
  refMid: 1n,
  refTiltBps: 0,
  refSeq: 1,
  refAgeSeconds: 0n,
};

test("consecutive publishes that changed nothing fold into one row with a count and a span", () => {
  // Thirteen publishes of the same three shifts said the same thing thirteen times and pushed the
  // fill and the refusals, the rows that record something happening, off the bottom.
  const rows = [1300n, 1200n, 1100n, 1000n].map((t, i) =>
    round(t, 100 - i, [
      [1, -500],
      [2, 57],
    ]),
  );
  const folded = foldRounds(rows);
  expect(folded).toHaveLength(1);
  expect(folded[0]).toMatchObject({ kind: "fold", count: 4, from: 1000n, to: 1300n });
});

test("a publish that changed a shift starts a new row", () => {
  const rows = [
    round(1300n, 3, [[1, -500]]),
    round(1200n, 2, [[1, -500]]),
    round(1100n, 1, [[1, -349]]),
  ];
  const folded = foldRounds(rows);
  expect(folded).toHaveLength(2);
  expect(folded[0]).toMatchObject({ kind: "fold", count: 2 });
  expect(folded[1]).toMatchObject({ kind: "round", seq: 1 });
});

test("a fill or a refusal between two identical publishes is never folded over", () => {
  // Time order is the whole point of the feed: the beat is fill, then publish.
  const rows = [round(1300n, 2, [[1, -500]]), fill, round(400n, 1, [[1, -500]])];
  const folded = foldRounds(rows);
  expect(folded.map((r) => r.kind)).toEqual(["round", "fill", "round"]);
});

test("a single publish stays an ordinary row", () => {
  expect(foldRounds([round(1n, 1, [[1, 5]])])[0]!.kind).toBe("round");
});

test("a round where the published mid changed source is named, and an ordinary move is not", () => {
  // The fast workflow moved from per-leg pool mids to one mainnet mid on 2026-09-11: the published
  // mid jumped twelvefold in a single round and every leg's shift went into its band. A reader
  // looking at that row sees a market event unless the row says otherwise.
  const leg = (mid: bigint) => [{ chainId: 11155111, tiltBps: 0, mid, transaction: "0x1" }];
  const round = (seq: number, mid: bigint): FeedRound => ({
    kind: "round",
    timestamp: BigInt(seq),
    seq,
    count: 1,
    spanSeconds: 0,
    legs: leg(mid),
  });
  // Newest first, as the feed is ordered.
  const rows = [
    round(3, 404_625_046n * 10n ** 18n),
    round(2, 33_126_803n * 10n ** 18n),
    round(1, 33_126_803n * 10n ** 18n),
  ];
  const changed = referenceChanges(rows);
  expect(changed.has(3)).toBe(true);
  expect(changed.has(2)).toBe(false);
  expect(changed.size).toBe(1);
});

test("a mid that merely moved, however sharply, is not called a change of source", () => {
  const round = (seq: number, mid: bigint): FeedRound => ({
    kind: "round",
    timestamp: BigInt(seq),
    seq,
    count: 1,
    spanSeconds: 0,
    legs: [{ chainId: 11155111, tiltBps: 0, mid, transaction: "0x1" }],
  });
  // Forty percent in one publish would be an extraordinary market and is still a market.
  const rows = [round(2, 140n * 10n ** 18n), round(1, 100n * 10n ** 18n)];
  expect(referenceChanges(rows).size).toBe(0);
});
