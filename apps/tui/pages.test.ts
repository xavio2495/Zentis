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
  // The command is the console's own, since a compiled binary has no checkout to run a script from.
  expect(text).toMatch(/: ?push /);
  expect(frame.overflows).toBe(false);
}, 60_000);

test("a leg long of tokenB is told a top-up cannot fix it, and is offered no command", async () => {
  const frame = await drive(190, 50, { keys: ["p"], scenario: "long" });
  const text = frame.lines.join("\n");
  expect(text).toMatch(/only adds|cannot/);
  expect(text).not.toContain("scripts/rebalance.py --only arbitrum");
}, 60_000);

test("the rebalance panel never loses a character to a column, at any width", async () => {
  // Built without measuring, the row came out as "top u0.00000958" and "--onl" with words from one
  // leg bleeding into the next: Ink squeezes an overlong row by deleting characters inside it.
  for (const [cols, rows] of [
    [190, 50],
    [120, 40],
    [80, 24],
  ] as const) {
    const text = (await drive(cols, rows, { keys: ["p"], scenario: "pinned" })).lines.join("\n");
    expect(text).not.toMatch(/top u\d/);
    expect(text).not.toMatch(/--onl\b/);
    expect(text).not.toMatch(/WETHia/);
    // The command, when it is offered at all, is offered whole.
    if (text.includes("rebalance.py")) expect(text).toMatch(/python3 scripts\/rebalance\.py --only [a-z-]+/);
  }
}, 120_000);

test("a leg closer to the mid than its own spread is left alone, with no command to run", async () => {
  // A top-up of 0.0000096 WETH is noise: it cannot move a quote that already sits inside the spread
  // the leg charges, so it is never offered as a move worth making.
  //
  // Asserted as the rule rather than against one leg: this reads the recorded moment, and which leg
  // is where in it changes every time the fixtures are re-recorded. What may not change is that
  // every leg the panel names is either given a whole command or told why it has none.
  const text = (await drive(190, 50, { keys: ["p"] })).lines.join("\n");
  expect(text).not.toMatch(/top up 0\.00000/);
  for (const name of ["Sepolia", "Base", "Arbitrum"]) {
    const said = text.includes(`${name} is on the mid`) || text.includes(`${name} holds`);
    expect(said).toBe(true);
  }
  // A leg that cannot be fixed by a push says so; one that can gets the command in full.
  if (/top up /.test(text)) expect(text).toMatch(/: push [a-z]+ [a-z]+ [\d.]+/);
  expect(text).toMatch(/within its own spread|a push only adds|top up /);
}, 60_000);

test("a card carries no venue price, since the book does not quote from that pool", async () => {
  // "venue 1 WETH = 28,430 USDC" on a card beside "market 1 WETH = 2,372" reads as a bug. The venue
  // is where the leg's trades settle; its address and last swap live in the leg's detail.
  const text = (await drive(120, 40, {})).lines.join("\n");
  expect(text).not.toMatch(/venue 1 WETH/);
  expect(text).not.toMatch(/venue: this leg's reference pool was…/);
  expect(text).not.toMatch(/venue.*…/);
}, 60_000);

test("the pnl page does not send a reader to a card for a pool mid the cards no longer carry", async () => {
  const text = (await drive(190, 50, { keys: ["n"] })).lines.join("\n");
  expect(text).not.toContain("own pool mid is on its card");
}, 60_000);

test("the positions table drops whole columns at eighty columns rather than clipping its headers", async () => {
  const lines = (await drive(80, 24, { keys: ["p"] })).lines;
  const header = lines.find((l) => /\bleg\b|\ble\b/.test(l) && /state|shift/.test(l))!;
  expect(header).toBeDefined();
  for (const clipped of ["le ", "at mar", "shif ", "hold "]) {
    expect(header).not.toContain(clipped);
  }
  // What survives at that width is the row's name and what it is doing.
  expect(header).toContain("leg");
  expect(header).toMatch(/state/);
}, 60_000);

test("the help page wraps rather than clipping, because it is the page that explains the rest", async () => {
  const text = (await drive(120, 40, { keys: ["?"] })).lines.join("\n");
  expect(text).not.toContain("…");
}, 60_000);

test("the pnl page fills its lower half with the fills the totals are made of", async () => {
  // The totals are three rows and the page is twenty; what belongs underneath is what they are made
  // of — each fill, its size, and what it took against the reference and the one published after it.
  const snapshot = fakeSnapshot("fresh");
  const fills = snapshot.legs.flatMap((l) => l.pnl?.perFill ?? []);
  expect(fills.length).toBeGreaterThan(0);
  const text = (await drive(190, 50, { keys: ["n"] })).lines.join("\n");
  expect(text).toMatch(/per fill|each fill/);
  // Dated, sized and scored: a row per fill rather than a repeat of the total.
  expect(text).toMatch(/\d+[dhm] ago|\d+[dhm]\b/);
  expect(text).toContain("markout");
}, 60_000);

test("the rebalance panel offers the console's own command, which a compiled binary can run", async () => {
  // "python3 scripts/rebalance.py" cannot work from a console handed to someone with no checkout.
  const text = (await drive(190, 50, { keys: ["p"], scenario: "pinned" })).lines.join("\n");
  expect(text).not.toContain("rebalance.py");
  expect(text).toMatch(/: ?push sepolia weth/);
}, 60_000);
