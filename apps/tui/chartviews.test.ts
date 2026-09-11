import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

/**
 * Each card draws its own leg, and the arrows drive the chart.
 *
 * The cards had a graph and lost it when the venue prices were dropped; what they have instead is
 * the one line that is genuinely theirs. And the market section had no control of its own — the
 * arrows were selecting a leg that nothing on the chart followed — so the arrows drive the chart
 * now and the numbers drive the detail.
 */
const cardOf = (lines: string[], title: string): string[] => {
  const top = lines.findIndex((l) => l.startsWith(`┌ ${title}`));
  if (top === -1) return [];
  const rows: string[] = [];
  for (const line of lines.slice(top + 1)) {
    if (!line.startsWith("│")) break;
    rows.push(line.slice(1, line.indexOf("│", 1) === -1 ? undefined : line.indexOf("│", 1)));
  }
  return rows;
};

test("every card draws its own leg's shift, including the legs with no venue left", async () => {
  const lines = (await drive(120, 40, {})).lines;
  for (const title of ["1 Sepolia", "2 Base Sepolia", "3 Arbitrum Sepolia"]) {
    const card = cardOf(lines, title).join("\n");
    expect(card).toMatch(/[─╭╮╰╯│]{3,}/);
    // Labelled as what it is, since a line of bps and a line of prices look the same.
    expect(card).toMatch(/shift/);
  }
}, 60_000);

test("the card's line says the range it is drawn over, so a flat leg is not read as a dead one", async () => {
  const card = cardOf((await drive(120, 40, {})).lines, "1 Sepolia").join("\n");
  expect(card).toMatch(/-?\d+ to [-+]?\d+|over \d+[hm]/);
}, 60_000);

test("the arrows cycle what the chart shows, and say which view it is on", async () => {
  const market = (await drive(150, 44, {})).lines.join("\n");
  expect(market).toMatch(/┌ market/);

  const next = (await drive(150, 44, { keys: ["RIGHT"] })).lines.join("\n");
  expect(next).not.toMatch(/┌ market ·/);
  expect(next).toMatch(/shift/);
  // Left from the first view wraps to the last rather than stopping.
  const back = (await drive(150, 44, { keys: ["LEFT"] })).lines.join("\n");
  expect(back).not.toBe(market);
}, 120_000);

test("the numbers still open a leg's detail, which the arrows no longer touch", async () => {
  const detail = (await drive(150, 44, { keys: ["2"] })).lines.join("\n");
  expect(detail).toContain("esc to close");
  expect(detail).toContain("2 Base Sepolia");
  // Arrows while a detail is open move the chart, not the detail.
  const stepped = (await drive(150, 44, { keys: ["2", "RIGHT"] })).lines;
  const title = stepped.find((l) => l.includes("esc to close"))!;
  expect(title).toContain("2 Base Sepolia");
}, 120_000);
