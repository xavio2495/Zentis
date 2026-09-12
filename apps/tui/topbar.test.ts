import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

/**
 * The top bar, as the operator asked for it: two rows and nothing spare.
 *
 * The book on the first, the reference's state on the second with the source marks right-aligned
 * beside it, and a note from the last action taking the book's row for five seconds before giving it
 * back. What went: "all answering · d", which said nothing a green row of marks did not, and
 * "n for why", which pointed at a page the keys row already names.
 */
const panelOf = (lines: string[], title: string): string[] => {
  const top = lines.findIndex((l) => l.includes(`┌ ${title}`));
  if (top === -1) return [];
  const edge = lines[top]!.indexOf(`┌ ${title}`);
  const rows: string[] = [];
  for (const line of lines.slice(top + 1)) {
    if (line[edge] !== "│") break;
    rows.push(line.slice(edge + 1).replace(/│\s*$/, "").trimEnd());
  }
  return rows;
};

test("the marks sit on the reference's own row, pushed to the right", async () => {
  const rows = panelOf((await drive(190, 50, {})).lines, "zentis").filter((r) => r.trim() !== "");
  expect(rows.length).toBe(2);
  expect(rows[0]).toContain("book ");
  const second = rows[1]!;
  expect(second).toMatch(/^reference|^every leg/);
  expect(second).toMatch(/rpc [●◐▲]{3}/);
  // Right-aligned: the marks end at the row's right edge rather than following the sentence.
  const width = rows[0]!.length;
  expect(second.trimEnd().length).toBeGreaterThan(width - 12);
}, 60_000);

test("the row of marks says nothing more when everything is answering", async () => {
  const rows = panelOf((await drive(190, 50, {})).lines, "zentis").join("\n");
  expect(rows).not.toContain("all answering");
  expect(rows).not.toContain("· d");
}, 60_000);

test("the book line does not point at a page the keys row already offers", async () => {
  // The book now has a profit to show — every leg carries the mark it was shipped against — so what
  // this guards is the pointer, not the word that happened to be beside it.
  const rows = panelOf((await drive(190, 50, {})).lines, "zentis").join("\n");
  expect(rows).toMatch(/profit ([-+][\d.]|unknown)/);
  expect(rows).not.toContain("n for why");
}, 60_000);

test("a note takes the book's row, and gives it back", async () => {
  // Pressing a key that is off is a note, not a state: it belongs where the reader is looking, and
  // only for as long as it is news.
  const said = (await drive(120, 40, { keys: ["f"] })).lines.join("\n");
  expect(said).toMatch(/watch-only/);
  expect(said).toContain("? says how to arm it");
  const rows = panelOf((await drive(120, 40, { keys: ["f"] })).lines, "zentis").filter((r) => r.trim() !== "");
  // Still two rows: the note replaced the book rather than pushing the panel taller.
  expect(rows.length).toBe(2);
  expect(rows[0]).not.toContain("book ");
}, 60_000);

test("the keys row titles every key it shows, including the navigation ones", async () => {
  const lines = (await drive(190, 50, { publisher: "cloud" })).lines;
  const keys = panelOf(lines, "keys").join("\n");
  for (const titled of ["? help", "x quit", "t window", "enter detail"]) {
    expect(keys).toContain(titled);
  }
}, 60_000);
