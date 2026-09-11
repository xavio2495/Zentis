import { expect, test } from "bun:test";
import { weightPercent } from "@zentis/console-data";
import { tokenAmount } from "./src/format.js";
import { drive } from "./sandbox/drive.js";
import { fakeSnapshot } from "./sandbox/world.js";

/**
 * The overall view: one row that says what the maker owns, whether it is one book, and whether it
 * is making money. Everything asserted here is read out of the same snapshot the frame was drawn
 * from, so an ordinary re-record of the fixtures cannot turn a rendering test red.
 */
/**
 * A row of the status panel, cut out of the frame at that panel's own left edge. Every physical
 * line also carries the leg-card column, so a helper that searched the whole line would read the
 * cards' numbers as the status bar's.
 */
const rowWith = (lines: string[], needle: string): string | undefined => {
  const top = lines.findIndex((l) => l.includes("┌ zentis"));
  if (top === -1) return undefined;
  const column = lines[top]!.indexOf("┌ zentis");
  return lines
    .slice(top + 1)
    .map((l) => l.slice(column + 1).replace(/│\s*$/, "").trimEnd())
    .find((l) => l.includes(needle));
};

test("the overall view says the inventory, the split, the legs and the mode on one row at 80 columns", async () => {
  const snapshot = fakeSnapshot("fresh");
  const symbol = snapshot.legs[0]!.config.tokenA.symbol;
  const inventory = tokenAmount(snapshot.book.inventoryA!, snapshot.legs[0]!.config.tokenA.decimals);

  const frame = await drive(80, 24, {});
  const row = rowWith(frame.lines, "book");
  expect(row).toBeDefined();
  expect(row).toContain(inventory);
  expect(row).toContain(symbol);
  expect(row).toContain(`${weightPercent(snapshot.book.weightA!)}%`);
  expect(row).toContain("watch-only");
  expect(frame.width).toBeLessThanOrEqual(80);
}, 60_000);

test("the wide overall view carries the legs active, the seq and the pulse as well", async () => {
  const snapshot = fakeSnapshot("fresh");
  const frame = await drive(190, 50, { armed: true });
  const row = rowWith(frame.lines, "book")!;
  expect(row).toContain(`${snapshot.book.legsActive}/${snapshot.book.legs}`);
  expect(row).toContain(String(snapshot.seq));
  expect(row).toContain("armed");
  expect(row).toMatch(/polled|polling/);
}, 60_000);

test("the even split is marked, so a lean is read against it rather than guessed at", async () => {
  const frame = await drive(190, 50, {});
  const row = rowWith(frame.lines, "book")!;
  expect(row).toMatch(/even/);
}, 60_000);

test("a profit that cannot be separated from the hold effect is unknown, never a zero", async () => {
  // Hold is null on every generation shipped before the mark was recorded, so the book has no total.
  // A row that printed 0 would claim the maker broke even, which nothing read says.
  const snapshot = fakeSnapshot("fresh");
  expect(snapshot.book.pnlA).toBeNull();
  const row = rowWith((await drive(190, 50, { armed: true })).lines, "book")!;
  expect(row).toContain("profit");
  expect(row).toMatch(/profit unknown/);
  expect(row).not.toMatch(/profit [-+]?[\d.]/);
}, 60_000);

test("the overall view's numbers survive the narrowest terminal whole", async () => {
  for (const [cols, rows] of [
    [190, 50],
    [120, 40],
    [100, 30],
    [80, 24],
  ] as const) {
    const row = rowWith((await drive(cols, rows, { armed: true })).lines, "book")!;
    expect(row).toBeDefined();
    // Squeezing eats the separators first, so a label running into its number is the signature.
    expect(row).not.toMatch(/book\d/);
    expect(row).not.toMatch(/\d{4}\.\d/);
  }
}, 60_000);

test("with legs unread the overall view says the split is unknown and how much of the book it valued", async () => {
  // A split computed from the legs that answered is not the book's split, and an inventory summed
  // over one leg of three is not the book's inventory. Both say so rather than reading as the whole.
  const snapshot = fakeSnapshot("partial");
  const unread = snapshot.legs.filter((l) => l.sources.fills !== null).length;
  expect(unread).toBeGreaterThan(0);
  const row = rowWith((await drive(190, 50, { scenario: "partial" })).lines, "book")!;
  expect(row).toContain("split unknown");
  expect(row).not.toMatch(/\d+% USDC/);
  expect(row).toContain(`${snapshot.book.legs - unread} of ${snapshot.book.legs} legs`);
}, 60_000);

test("the state row leaves the book's facts to the book row rather than repeating them", async () => {
  // Two rows both carrying the split showed 64.8% above 50%: the same word for two different marks.
  const lines = (await drive(190, 50, { armed: true })).lines;
  const book = rowWith(lines, "book")!;
  const state = rowWith(lines, "reference fresh")!;
  expect(book).not.toBe(state);
  expect(state).not.toMatch(/% USDC/);
  expect(state).not.toContain("armed");
}, 60_000);

test("with nothing valued the profit is unknown, never a zero the book did not earn", async () => {
  // The outage frame said "book unvalued · split unknown · … · profit 0 USDC". Zero is a claim that
  // the maker earned nothing, and nothing was read to support it — the same failure `bookTotals`
  // exists to refuse, arriving through a different door.
  const snapshot = fakeSnapshot("outage");
  expect(snapshot.book.inventoryA).toBeNull();
  const row = rowWith((await drive(190, 50, { scenario: "outage" })).lines, "book")!;
  expect(row).toContain("profit unknown");
  expect(row).not.toMatch(/profit [-+]?[\d.]/);
}, 60_000);
