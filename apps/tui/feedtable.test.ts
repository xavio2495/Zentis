import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

/** The feed panel's rows, header first, cut out of the frame by character, not by byte. */
const feedOf = (lines: string[]): string[] => {
  const header = lines.findIndex((l) => l.includes("┌ feed"));
  if (header === -1) return [];
  const column = [...lines[header]!].indexOf("┌") + 1;
  const rows: string[] = [];
  for (const line of lines.slice(header + 1)) {
    const cell = [...line].slice(column).join("");
    if (cell.startsWith("╰")) break;
    rows.push(cell.replace(/│\s*$/, "").trimEnd());
  }
  return rows.filter((r) => r.trim() !== "");
};

/** Where each chain's column starts, read off the header row. */
const columnsOf = (header: string) => ({
  Sepolia: header.indexOf("Sepolia"),
  Base: header.indexOf("Base"),
  Arbitrum: header.indexOf("Arbitrum"),
});

const SIZES = [
  [190, 50],
  [120, 40],
  [100, 30],
  [80, 24],
] as const;

test("the feed opens with a header naming each chain's column, in the cards' order", async () => {
  for (const [cols, rows] of SIZES) {
    const [header] = feedOf((await drive(cols, rows, { armed: true })).lines);
    expect(header).toBeDefined();
    const at = columnsOf(header!);
    expect(header).toMatch(/when/);
    expect(at.Sepolia).toBeGreaterThan(0);
    expect(at.Base).toBeGreaterThan(at.Sepolia);
    expect(at.Arbitrum).toBeGreaterThan(at.Base);
  }
}, 60_000);

test("every publish puts each leg's shift under that leg's name, so the shifts line up down the page", async () => {
  for (const [cols, rows] of SIZES) {
    const [header, ...body] = feedOf((await drive(cols, rows, { armed: true })).lines);
    const at = columnsOf(header!);
    // A publish's event is its seq, with or without the words before it, depending on the width.
    const publishes = body.filter((r) => /publish|\b\d{10}\b/.test(r));
    expect(publishes.length).toBeGreaterThan(0);
    for (const row of publishes) {
      for (const start of Object.values(at)) {
        // A cell starts exactly at its column: the character there is the start of a value and the
        // one before it is the gap.
        expect(row[start - 1]).toBe(" ");
        expect(row[start]).toMatch(/[-+0–u]/);
      }
    }
  }
}, 60_000);

test("a refusal is written under the chain that refused it", async () => {
  const [header, ...body] = feedOf((await drive(190, 50, { armed: true })).lines);
  const at = columnsOf(header!);
  const rejections = body.filter((r) => /rejected/.test(r));
  expect(rejections.length).toBeGreaterThan(0);
  for (const row of rejections) {
    const where = row.indexOf("stale seq");
    expect(Object.values(at)).toContain(where);
  }
}, 60_000);

test("a fill's amounts sit in the detail column after the chains, not across them", async () => {
  for (const [cols, rows] of [
    [190, 50],
    [120, 40],
  ] as const) {
    const [header, ...body] = feedOf((await drive(cols, rows, { armed: true })).lines);
    const at = columnsOf(header!);
    const fill = body.find((r) => /\bfill\b/.test(r));
    expect(fill).toBeDefined();
    expect(fill!.indexOf("→")).toBeGreaterThan(at.Arbitrum);
    expect(fill).toMatch(/WETH/);
  }
}, 60_000);

test("a leg the console could not read is marked unread in its own column", async () => {
  const [header, ...body] = feedOf((await drive(190, 50, { scenario: "partial" })).lines);
  const at = columnsOf(header!);
  const publish = body.find((r) => /publish/.test(r))!;
  expect(publish.slice(at.Base, at.Base + 6)).toBe("unread");
  expect(publish.slice(at.Arbitrum, at.Arbitrum + 6)).toBe("unread");
  expect(publish.slice(at.Sepolia)).toMatch(/^[-+]?\d/);
}, 60_000);

test("the refusals of one stale publish share a row, each under the chain that refused it", async () => {
  // Three chains refusing the same relayed seq within a minute is one event seen three times. As
  // three rows it spent three-quarters of the table on blank cells.
  const [header, ...body] = feedOf((await drive(190, 50, { armed: true })).lines);
  const at = columnsOf(header!);
  const together = body.find((r) => (r.match(/stale seq/g)?.length ?? 0) === 3);
  expect(together).toBeDefined();
  for (const start of Object.values(at)) expect(together!.slice(start, start + 9)).toBe("stale seq");
}, 60_000);
