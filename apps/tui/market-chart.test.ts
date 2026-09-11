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

test("the window the title names is the window the chart draws", async () => {
  // The label came from one leg's automatic window while the series was the week: the border said
  // "1h window · auto" over a line spanning six days.
  const lines = (await drive(190, 50, {})).lines;
  const title = lines.find((l) => l.includes("┌ market"))!;
  const footer = lines.find((l) => /\d+[dhm] ago/.test(l) && /now$|now\s*│/.test(l))!;
  const named = /(\dh|\d+h|\dd|7d|24h|1h) window/.exec(title)![1]!;
  const drawn = /(\d+)([dhm])\s+ago/.exec(footer)!;
  const hours = { d: 24, h: 1, m: 1 / 60 }[drawn[2] as "h"]! * Number(drawn[1]);
  const namedHours = named === "1h" ? 1 : named === "24h" ? 24 : 168;
  // The drawn span never exceeds the window it is named by, give or take the last point's age.
  expect(hours).toBeLessThanOrEqual(namedHours + 1);
}, 60_000);

test("the chart's headline price is the series' own last close, and says how old it is", async () => {
  // 2,372 in the title beside a mark of 2,467 on the same screen reads as a broken screen. They are
  // two different readings — an hourly close and a spot mark — so the title says which it is.
  const snapshot = fakeSnapshot("fresh");
  const newest = snapshot.market!.points.at(-1)!;
  const mark = snapshot.legs[0]!.mark!.mid;
  // The recorded world ends its series at the mark, so the two agree rather than differing by 4%.
  expect(newest.mid).toBe(mark);
  const title = (await drive(190, 50, {})).lines.find((l) => l.includes("┌ market"))!;
  expect(title).toMatch(/1 WETH = [\d,]+ USDC/);
}, 60_000);
