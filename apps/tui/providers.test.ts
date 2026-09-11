import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";
import { providersOf } from "@zentis/console-data";
import { DOT, dotColour, providerDots } from "./src/components/Providers.js";
import { UI } from "./src/theme.js";
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

test("the top panel is three rows: the book, its state, and one dot per source", async () => {
  // Eleven lines of sources took most of the panel at 190 columns, on a screen whose subject is the
  // book. The dots say whether anything is wrong; the page behind `d` says what.
  const snapshot = fakeSnapshot("fresh");
  const rows = panelOf((await drive(190, 50, { armed: true })).lines, "zentis").filter((r) => r.trim() !== "");
  expect(rows.length).toBeLessThanOrEqual(4);
  const joined = rows.join("\n");
  expect(joined).toContain("book ");
  expect(joined).toContain(String(snapshot.seq));
  expect(joined).toContain("armed");
  // One mark per source, in a fixed order, and no line-per-source list.
  expect(joined).toMatch(/rpc [●▲◐]{3}/);
  expect(joined).not.toContain("rpc sepolia   ");
}, 60_000);

test("the dots are green, yellow and red: answering, last-good, and down", () => {
  // Colour is the whole content of a dot, and the sandbox strips colour out of a frame, so this is
  // asserted where the colour is decided rather than through a rendered screen.
  expect(dotColour("up")).toBe(UI.fill);
  expect(dotColour("stale")).toBe(UI.caveat);
  expect(dotColour("down")).toBe(UI.rejection);

  const providers = providersOf(fakeSnapshot("partial"));
  const segs = providerDots(providers, 190);
  const coloured = segs.filter((seg) => /[●◐▲]/.test(seg.text));
  expect(coloured.length).toBe(providers.length);
  for (const seg of coloured) {
    expect([UI.fill, UI.caveat, UI.rejection] as string[]).toContain(seg.color!);
  }
  // The outage leaves marks of more than one colour, which is the point of having three.
  expect(new Set(coloured.map((seg) => seg.color)).size).toBeGreaterThan(1);
});

test("the status page behind d says, for every source, what it answered and when", async () => {
  const text = (await drive(190, 50, { keys: ["d"] })).lines.join("\n");
  for (const name of ["rpc sepolia", "fills sepolia", "quote service", "mark", "market series", "references"]) {
    expect(text).toContain(name);
  }
  // And more than the dots could carry: cadence, allowance, and the age of what it last said.
  expect(text).toMatch(/every \d+s|each poll/);
  expect(text).toMatch(/\d+ left|no allowance|—/);
}, 60_000);

test("a source that is down says why on the status page, with the time its window reopens", async () => {
  const text = (await drive(190, 50, { keys: ["d"], scenario: "partial" })).lines.join("\n");
  expect(text).toMatch(/429/);
  expect(text).toMatch(/21:52Z|resets/);
}, 60_000);

test("the status page is offered where every other page is: the keys row and help", async () => {
  const keys = (await drive(190, 50, { armed: true })).lines.join("\n");
  expect(keys).toMatch(/d (status|sources)/);
  const help = (await drive(190, 50, { keys: ["?", "DOWN", "DOWN"] })).lines.join("\n");
  expect(help).toMatch(/status/);
}, 60_000);

test("the panel says how many sources are down without listing them all", async () => {
  const rows = panelOf((await drive(190, 50, { scenario: "partial" })).lines, "zentis").join("\n");
  expect(rows).toMatch(/down|unread/);
  // The endpoint's own words are on the status page, not repeated up here.
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
