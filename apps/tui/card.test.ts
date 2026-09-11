import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

const cardOf = (lines: string[], name: string) => {
  const top = lines.findIndex((l) => l.includes(`┌ ${name}`) || l.includes(`${name} ─`));
  if (top === -1) return [] as string[];
  // Cut at the card's own right edge, found from its top border. Cutting at the first `│` does not
  // work: the inventory bar's even-split marker is also a `│`.
  const edge = [...lines[top]!].indexOf("┐") + 1;
  const out: string[] = [];
  for (const line of lines.slice(top + 1)) {
    if (line.startsWith("╰")) break;
    out.push([...line].slice(0, edge).join(""));
  }
  return out;
};

test("a live card carries the product's own numbers, not just a picture", async () => {
  const frame = await drive(120, 40, { armed: true });
  const card = cardOf(frame.lines, "1 Sepolia").join("\n");
  expect(card).toContain("holds");
  expect(card).toMatch(/\d+% USDC/); // the inventory split
  expect(card).toContain("shift");
  expect(card).toContain("spread");
});

test("both sides of the quote are shown, each with its distance from the mid", async () => {
  // One direction hides the spread and the shift's direction; the two together show both.
  const card = cardOf((await drive(120, 40, { armed: true })).lines, "1 Sepolia").join("\n");
  expect(card).toMatch(/USDC → .*WETH/);
  expect(card).toMatch(/WETH → .*USDC/);
  expect((card.match(/bps/g) ?? []).length).toBeGreaterThanOrEqual(2);
});

test("the sparkline is a few rows at the bottom, not most of the card", async () => {
  const card = cardOf((await drive(120, 40, { armed: true })).lines, "1 Sepolia");
  const lineRows = card.filter((row) => /[─│╭╮╰╯]{3,}/.test(row.slice(1, -1)));
  expect(lineRows.length).toBeLessThanOrEqual(4);
});

test("an unread card says what was unread and what was not, once", async () => {
  const card = cardOf((await drive(120, 40, { scenario: "outage" })).lines, "1 Sepolia").join("\n");
  expect(card).toContain("position unread");
  expect((card.match(/could not be read/g) ?? []).length).toBeLessThanOrEqual(1);
});

test("the card is titled with the same name the detail uses", async () => {
  const frame = (await drive(120, 40, { armed: true })).lines.join("\n");
  expect(frame).toContain("┌ 2 Base Sepolia");
  expect(frame).toContain("┌ 3 Arbitrum Sepolia");
});

test("with the decomposition withheld, the card still shows the shift the registry published", async () => {
  // Two legs unread withholds the decomposition — it reads every leg — but the published shift comes
  // from the registry over RPC and is known. Hiding it hid the product's own number exactly when a
  // viewer most needed it.
  const card = cardOf((await drive(120, 40, { scenario: "partial" })).lines, "2 Base Sepolia").join("\n");
  expect(card).toMatch(/shift [-+]?\d+/);
  expect(card).toContain("published");
});

test("a side the router refuses is shown as refused, not silently left out", async () => {
  const card = cardOf((await drive(120, 40, { scenario: "refused" })).lines, "1 Sepolia").join("\n");
  expect(card).toMatch(/USDC → .*WETH/);
  expect(card).toMatch(/WETH → USDC.*refused|refused.*WETH/);
});

test("a refusal the service decoded is named on the card by the contract's reason", async () => {
  const card = cardOf((await drive(120, 40, { scenario: "refused" })).lines, "1 Sepolia").join("\n");
  expect(card).toMatch(/WETH → USDC.*outside the band/);
});

test("a card's own price line is labelled as the leg's venue, not as what it quotes from", async () => {
  // Sepolia's pool reads 30,187 while the book quotes from a mainnet mark near 2,372. Printing the
  // first as "1 WETH = 30,187 USDC" on the card said the leg quotes at a price nothing quotes at.
  const card = cardOf((await drive(120, 40, {})).lines, "1 Sepolia").join("\n");
  expect(card).toMatch(/venue/);
  expect(card).not.toMatch(/^1 WETH = [\d,]+ USDC · \d+[dhm] window$/m);
});
