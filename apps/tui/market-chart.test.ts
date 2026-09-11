import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";
import { fakeSnapshot } from "./sandbox/world.js";
/**
 * One chart, for the book.
 *
 * Every leg quotes from one mid now, and the slow workflow measures its spread on the same series,
 * so the chart is that series. The three testnet pool charts it replaces were never what the legs
 * quoted from — they were where their trades settled, and two of them have been retired.
 */
test("the chart is the market the book prices from, named with its source", async () => {
  const snapshot = fakeSnapshot("fresh");
  expect(snapshot.market).not.toBeNull();
  const text = (await drive(190, 50, {})).lines.join("\n");
  expect(text).toContain("market");
  // The source sentence, so nobody has to ask which market this is.
  expect(text).toContain(snapshot.market!.source.split(",")[0]!);
  // Priced the way a reader thinks of it, not as a raw mid.
  expect(text).toMatch(/1 WETH = [\d,]+ USDC/);
}, 60_000);

test("the chart draws one line, not one per leg, and no longer rotates between them", async () => {
  const still = (await drive(190, 50, {})).lines.join("\n");
  for (const leg of ["market price · Sepolia", "market price · Base", "market price · Arbitrum"]) {
    expect(still).not.toContain(leg);
  }
}, 60_000);

test("publishes and fills are ticked against the market, which is what makes the beat visible", async () => {
  const text = (await drive(190, 50, {})).lines.join("\n");
  expect(text).toMatch(/publish/);
  expect(text).toMatch(/fill/);
}, 60_000);

test("with no market series the region says why rather than drawing a flat line", async () => {
  const text = (await drive(190, 50, { scenario: "outage" })).lines.join("\n");
  expect(text).toMatch(/market series|price history/);
}, 60_000);

test("the chart says how the series was drawn, since an hour of hourly closes is not what the market did", async () => {
  const text = (await drive(190, 50, {})).lines.join("\n");
  // The sandbox's series is hourly, and the chart says so rather than implying every point is a trade.
  expect(text).toMatch(/hourly|per swap/);
}, 60_000);
