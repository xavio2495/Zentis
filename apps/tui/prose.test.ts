import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

/**
 * The pages show data; the help page explains it.
 *
 * Every page had grown a paragraph — how Aqua's custody works, what the simulation claims, what the
 * book is marked at, why a leg quotes where it does. Each was true and each was in the way: prose
 * competing with numbers for the same rows, and read once at most. It lives under a heading per page
 * in `?` now. What stays on a page is the kind of caveat that changes what a number *means*, and
 * that stays as one flagged line rather than a paragraph.
 */
const pageText = async (key: string) => (await drive(190, 50, { keys: [key] })).lines.join("\n");

test("the wallet page shows balances, and Aqua's custody is explained in help", async () => {
  const wallet = await pageText("w");
  expect(wallet).not.toContain("Aqua holds no tokens");
  expect(wallet).toContain("committed");
  const help = await pageText("?");
  expect(help).toContain("Aqua");
  expect(help).toMatch(/wallet/);
}, 60_000);

test("the simulation page shows the run, and what it claims is in help", async () => {
  const sim = await pageText("m");
  expect(sim).not.toContain("uncalibrated");
  expect(sim).toMatch(/regime|seeds/);
  // In help under its own heading, which is below the first screen at this width: the page scrolls.
  const help = (await drive(190, 50, { keys: ["?", "DOWN", "DOWN", "DOWN"] })).lines.join("\n");
  expect(help).toContain("uncalibrated");
}, 60_000);

test("the pnl and positions pages drop their footnotes, keeping the caveat that changes a number", async () => {
  const pnl = await pageText("n");
  expect(pnl).not.toContain("marked at 1inch spot");
  // The one caveat that changes what a number means, as one line rather than a paragraph. Hold is
  // no longer unknown — every leg carries the mark it was shipped against — so what the line says
  // now is the thing that is still true of it: its two ends come from different sources.
  expect(pnl).not.toMatch(/hold unknown/);
  expect(pnl).toMatch(/backfilled|two sources|1inch spot/);
  expect(pnl.split("\n").filter((l) => l.includes("!")).length).toBeLessThanOrEqual(2);

  const positions = await pageText("p");
  expect(positions).not.toContain("marked at 1inch spot");
}, 60_000);

test("a leg's detail is numbers, with the sentence that explained them in help", async () => {
  const detail = (await drive(120, 40, { keys: ["1"] })).lines.join("\n");
  expect(detail).not.toMatch(/why\s+this leg's reserves/);
  expect(detail).toContain("correction");
  const help = await pageText("?");
  expect(help).toMatch(/detail/);
}, 60_000);

test("help gains a heading for each page it now explains", async () => {
  const help = await pageText("?");
  for (const heading of ["positions", "pnl", "wallet", "simulation"]) {
    expect(help).toContain(heading);
  }
}, 60_000);

test("help scrolls rather than hiding what it could not fit", async () => {
  // It explains five pages, the terms and how to arm the console, and at a hundred and twenty
  // columns that is more rows than the region has. Trimming it until it fits would be trimming the
  // explanation; the page moves instead, and says when there is more below it.
  const first = (await drive(120, 40, { keys: ["?"] })).lines.join("\n");
  expect(first).toMatch(/more below|↓/);
  const scrolled = (await drive(120, 40, { keys: ["?", "DOWN", "DOWN", "DOWN", "DOWN", "DOWN"] })).lines.join("\n");
  expect(scrolled).toContain("leg detail");
  expect(scrolled).toContain("terms");
  // And back up again, to what it opened on.
  const returned = (await drive(120, 40, { keys: ["?", "DOWN", "DOWN", "UP", "UP", "UP"] })).lines.join("\n");
  expect(returned).toContain("what this is");
}, 120_000);

test("the status page carries the record's own sentence about the opening mark, in full", async () => {
  // The pnl page has one line for it; this is the page that says where every number came from, so
  // the sentence the deployment record carries is quoted here whole rather than summarised. A
  // provenance note nobody can read in full is a provenance note.
  const status = (await drive(190, 50, { keys: ["d"] })).lines.join(" ").replace(/[│┌┐╰╯─]/g, " ").replace(/\s+/g, " ");
  expect(status).toContain("hourly close");
  expect(status).toContain("not read at ship time");
}, 60_000);

test("the pnl page names the inventory hold does not cover, in the leg's own units", async () => {
  // A leg pushed to after it shipped holds tokenB that hold says nothing about, and the book's hold
  // understates by whatever that inventory has done since. The page cannot value it — no record
  // carries a mark from the moment of the push — but leaving it unsaid is the one option that makes
  // the total look complete when it is not.
  const pnl = await pageText("n");
  expect(pnl).toMatch(/no recorded price|does not speak for it/i);
  expect(pnl).toMatch(/WETH/);
}, 60_000);

test("the page says which span its totals cover, and reports the position's whole life apart", async () => {
  // Every figure in the table is this generation's, because hold is: a total that added a
  // lifetime's trading to one generation's hold answered two questions at once. What the position
  // did before its last ship is still shown, on its own line, labelled as the other span.
  const pnl = await pageText("n");
  expect(pnl).toMatch(/since first ship/i);
  expect(pnl).toMatch(/generation/i);
}, 60_000);

