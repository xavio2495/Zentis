import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";
import { fakeSnapshot } from "./sandbox/world.js";

/**
 * The critical-information panel: what the book is, and whether the things it reads are answering.
 *
 * The keys moved out of it to a section of their own below the feed, because a row of keys is not
 * critical information and it was sitting above the one thing that is.
 */
const panelOf = (lines: string[], title: string): string[] => {
  const top = lines.findIndex((l) => l.includes(`┌ ${title}`));
  if (top === -1) return [];
  const edge = lines[top]!.indexOf(`┌ ${title}`);
  const column = edge + 1;
  const rows: string[] = [];
  for (const line of lines.slice(top + 1)) {
    // A panel's rows are the ones whose left edge is still its border.
    if (line[edge] !== "│") break;
    const cell = line.slice(column);
    rows.push(cell.replace(/│\s*$/, "").trimEnd());
  }
  return rows;
};

test("the top panel names every source the console reads, and says which are answering", async () => {
  const snapshot = fakeSnapshot("fresh");
  const rows = panelOf((await drive(190, 50, { armed: true })).lines, "zentis").join("\n");
  // Two per chain, plus the three services and the references' own freshness.
  for (const name of ["rpc sepolia", "fills sepolia", "quote service", "mark", "market series", "references"]) {
    expect(rows).toContain(name);
  }
  expect(rows).toContain("book ");
  expect(rows).toContain(String(snapshot.seq));
  expect(rows).toContain("armed");
}, 60_000);

test("a source that is down says so there, in a few words rather than a paragraph", async () => {
  const rows = panelOf((await drive(190, 50, { scenario: "partial" })).lines, "zentis").join("\n");
  expect(rows).toMatch(/429/);
  // The sentence that used to spread across the feed and the cards is not repeated here.
  expect(rows).not.toContain("showing what it last read");
}, 60_000);

test("the keys live below the feed now, not above the book", async () => {
  const lines = (await drive(190, 50, { armed: true })).lines;
  const top = panelOf(lines, "zentis").join("\n");
  expect(top).not.toMatch(/\bx quit\b/);
  const feedAt = lines.findIndex((l) => l.includes("┌ feed"));
  const keysAt = lines.findIndex((l) => l.includes("┌ keys"));
  expect(keysAt).toBeGreaterThan(feedAt);
  expect(panelOf(lines, "keys").join("\n")).toMatch(/republish|r s f q/);
}, 60_000);

test("the whole console still fits at eighty by twenty-four with the new section", async () => {
  const frame = await drive(80, 24, { armed: true });
  expect(frame.overflows).toBe(false);
  const text = frame.lines.join("\n");
  // Even at that size the panel says what is down and what the book is.
  expect(text).toMatch(/rpc|fills/);
  expect(text).toContain("book ");
}, 60_000);
