import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";
import { fakeSnapshot } from "./sandbox/world.js";

/**
 * The operator's pages: the legs as objects, what the book earned, the maker's wallet, and the
 * committed simulation. Each replaces the chart and the feed; the cards and the overall view stay.
 */
const PAGES = [
  ["p", "positions"],
  ["n", "pnl"],
  ["w", "wallet"],
  ["m", "simulation"],
] as const;

const SIZES = [
  [190, 50],
  [80, 24],
] as const;

test("each page key opens its page in place of the chart and the feed, and esc goes back", async () => {
  for (const [key, name] of PAGES) {
    const opened = (await drive(120, 40, { keys: [key] })).lines.join("\n");
    expect(opened).toContain(name);
    expect(opened).not.toContain("┌ feed");

    const returned = (await drive(120, 40, { keys: [key, "ESC"] })).lines.join("\n");
    expect(returned).toContain("┌ feed");
  }
}, 120_000);

test("the leg cards and the overall view stay on every page, so the live numbers never leave", async () => {
  for (const [key] of PAGES) {
    const text = (await drive(120, 40, { keys: [key] })).lines.join("\n");
    expect(text).toContain("1 Sepolia");
    expect(text).toContain("book ");
  }
}, 120_000);

test("the status bar names the page being read", async () => {
  for (const [key, name] of PAGES) {
    const lines = (await drive(120, 40, { keys: [key] })).lines;
    const title = lines.find((l) => l.includes("zentis"))!;
    expect(title).toContain(name);
  }
}, 120_000);

test("every page holds at both sizes, with no overflow and no digit dropped", async () => {
  for (const [key] of PAGES) {
    for (const [cols, rows] of SIZES) {
      const frame = await drive(cols, rows, { keys: [key], armed: true });
      expect(frame.overflows).toBe(false);
      expect(frame.width).toBeLessThanOrEqual(cols);
      const text = frame.lines.join("\n");
      // Ink squeezes an overlong row by deleting characters inside it; a label run into its number
      // is the signature, and a raw eighteen-decimal integer is a number nobody asked to read.
      for (const pattern of [/shift[-+]/, /spread\d/, /seq\d/, /\d{13,}/]) {
        expect(text).not.toMatch(pattern);
      }
    }
  }
}, 240_000);

test("the positions page says what each leg is: its hash, its generations and its state", async () => {
  const snapshot = fakeSnapshot("fresh");
  const leg = snapshot.legs[0]!;
  const text = (await drive(190, 50, { keys: ["p"] })).lines.join("\n");
  expect(text).toContain(leg.config.strategyHash.slice(0, 10));
  expect(text).toContain(`${leg.config.generations}`);
  expect(text).toMatch(/active|docked|unread/);
}, 60_000);

test("the pnl page counts the fills the fixtures hold and refuses a hold it cannot separate", async () => {
  const snapshot = fakeSnapshot("fresh");
  const withFills = snapshot.legs.find((l) => (l.pnl?.fills ?? 0) > 0)!;
  expect(withFills.pnl!.holdA).toBeNull();
  const text = (await drive(190, 50, { keys: ["n"] })).lines.join("\n");
  expect(text).toContain(String(withFills.pnl!.fills));
  // The reason, not a zero: hold is a price change over time and these generations have no opening
  // mark from the same source.
  expect(text).toMatch(/hold/);
  expect(text).not.toMatch(/hold\s+0\b/);
}, 60_000);

test("the wallet page says what the signer is and what each chain holds, committed and free", async () => {
  const snapshot = fakeSnapshot("fresh");
  expect(snapshot.wallet).not.toBeNull();
  const text = (await drive(190, 50, { keys: ["w"] })).lines.join("\n");
  expect(text).toContain("watch-only");
  expect(text).toContain(snapshot.wallet!.maker.slice(0, 10));
  expect(text).toContain("committed");
  expect(text).toContain("free");
}, 60_000);

test("the simulation moved out of the help overlay, which keeps its disclosures", async () => {
  const sim = (await drive(190, 50, { keys: ["m"] })).lines.join("\n");
  expect(sim).toMatch(/mean|worst/);
  const help = (await drive(190, 50, { keys: ["?"] })).lines.join("\n");
  expect(help).toContain("uncalibrated");
  expect(help).toContain("gains");
}, 60_000);

test("the positions page offers a rebalance for a leg whose reserves sit off the mid", async () => {
  // Constructed rather than borrowed from the fixtures: whether a leg is off the mid on any given
  // day is the market's business, and the panel has to be testable on the day it is not.
  const frame = await drive(190, 50, { keys: ["p"], scenario: "pinned" });
  const text = frame.lines.join("\n");
  expect(text).toContain("rebalance");
  // The move, sized from the leg's own balances against the mid, with the command to make it.
  expect(text).toMatch(/push .*WETH|top up .*WETH/);
  expect(text).toContain("scripts/rebalance.py");
  expect(text).toContain("--only");
  expect(frame.overflows).toBe(false);
}, 60_000);

test("a leg long of tokenB is told a top-up cannot fix it, and is offered no command", async () => {
  const frame = await drive(190, 50, { keys: ["p"], scenario: "long" });
  const text = frame.lines.join("\n");
  expect(text).toMatch(/only adds|cannot/);
  expect(text).not.toContain("scripts/rebalance.py --only arbitrum");
}, 60_000);
