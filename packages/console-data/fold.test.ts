import { expect, test } from "bun:test";
import { type FeedRow, foldRounds } from "./src/fills.js";

const round = (timestamp: bigint, seq: number, tilts: [number, number][]): FeedRow => ({
  kind: "round",
  timestamp,
  seq,
  count: tilts.length,
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
