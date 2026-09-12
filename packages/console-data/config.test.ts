import { expect, test } from "bun:test";
import { LEGS } from "./src/config.js";

/**
 * What the deployment records say about themselves.
 *
 * The mark a leg was shipped against is the opening end of hold, and it was not read at ship time —
 * it was backfilled the next day from the Uniswap v3 mainnet hourly series, while the closing mark
 * the console uses is 1inch spot. The two ends come from different sources by construction, which
 * is a thing a reader has to be told rather than left to discover, so the record carries the
 * sentence and every screen quotes that sentence instead of an approximation of it.
 */
test("a backfilled opening mark says so in the record, and the record is what a screen reads", () => {
  for (const leg of LEGS) {
    expect(leg.shipped.markAtShip).not.toBeNull();
    expect(leg.shipped.markAtShipSource).toMatch(/backfilled/i);
    expect(leg.shipped.markAtShipAt).toBeGreaterThan(0);
  }
});

test("the three legs were shipped against one mark, because they are one book", () => {
  const marks = new Set(LEGS.map((leg) => String(leg.shipped.markAtShip)));
  expect(marks.size).toBe(1);
});
