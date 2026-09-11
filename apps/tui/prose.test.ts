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
  const help = await pageText("?");
  expect(help).toContain("uncalibrated");
}, 60_000);

test("the pnl and positions pages drop their footnotes, keeping the caveat that changes a number", async () => {
  const pnl = await pageText("n");
  expect(pnl).not.toContain("marked at 1inch spot");
  // Hold being unknown changes what "total" means, so it stays — as one line, not a paragraph.
  expect(pnl).toMatch(/hold unknown|no opening mark/);
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
