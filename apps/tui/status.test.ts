import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

const statusOf = (lines: string[]) => {
  const top = lines.findIndex((l) => l.includes("┌ zentis"));
  const column = [...lines[top]!].indexOf("┌");
  const out: string[] = [];
  for (const line of lines.slice(top + 1)) {
    const cell = [...line].slice(column).join("");
    if (cell.startsWith("╰")) break;
    out.push(cell);
  }
  return out.join("\n");
};

test("the status bar says the screen is live: when it last polled", async () => {
  expect(statusOf((await drive(190, 50, { armed: true })).lines)).toMatch(/polled \d+[smh] ago|polling/);
});

test("a fresh reference's age is given against its limit, so fresh and 21m do not read as a contradiction", async () => {
  expect(statusOf((await drive(190, 50, { armed: true })).lines)).toMatch(/fresh · \d+[smh]\w* of \d+h/);
});

test("with legs unread the book split is said to be unknown, never a confident zero", async () => {
  const status = statusOf((await drive(190, 50, { scenario: "partial" })).lines);
  expect(status).not.toMatch(/\b0% USDC/);
  // The split lives in the overall view above now, which is the book’s own row.
  expect(status).toContain("split unknown");
});

/** The keys have a section of their own below the feed; this reads that panel rather than the top. */
const keysOf = (lines: string[]) => {
  const top = lines.findIndex((l) => l.includes("\u250c keys"));
  if (top === -1) return "";
  const column = lines[top]!.indexOf("\u250c keys");
  return lines
    .slice(top + 1)
    .map((l) => l.slice(column + 1).replace(/\u2502\s*$/, "").trimEnd())
    .filter((l) => !l.startsWith("\u2570"))
    .join("\n");
};

test("the key hints are always there, and pressing a disabled key does not replace them", async () => {
  const watching = keysOf((await drive(120, 40, { keys: ["r"] })).lines);
  expect(watching).toMatch(/r .*s .*f .*q/);
  // The signing-key sentence is not a warning for someone who only wants to watch.
  expect(watching).not.toContain("set ZENTIS_ENV");
  expect(statusOf((await drive(120, 40, { keys: ["r"] })).lines)).not.toContain("set ZENTIS_ENV");
});

test("how to arm the console is in the help overlay", async () => {
  const help = (await drive(120, 40, { keys: ["?"] })).lines.join("\n");
  expect(help).toContain("ZENTIS_ENV");
});

test("the hints name the pages and the command line, since a key nobody is told about is not a key", async () => {
  // The pages and the colon arrived after the hint row was written, so the row went on listing the
  // live view's keys alone: three pages and a command line that only the help page knew existed.
  const hints = (await drive(190, 50, { armed: true })).lines.find((l) => /\br republish/.test(l))!;
  expect(hints).toBeDefined();
  for (const key of ["p", "n", "w", "m", ":"]) {
    expect(hints).toContain(key);
  }
  // "p pos" once the status page joined the row: the word is shortened, never the key.
  expect(hints).toMatch(/p pos|positions/);
}, 60_000);

test("the narrow hint row keeps every key, dropping only the words around them", async () => {
  const hints = (await drive(80, 24, { armed: true })).lines.find((l) => /^│r /.test(l.slice(l.lastIndexOf("││") + 1)) || /r s f q/.test(l))!;
  expect(hints).toBeDefined();
  for (const key of ["r", "s", "f", "q", "p", "n", "w", "m", ":", "?", "x"]) {
    expect(hints).toContain(key);
  }
}, 60_000);

test("at a hundred and twenty columns the hints carry short labels, not bare letters", async () => {
  // Bare "r s f q p n w m : ←→ enter t ? x" is a row of letters to guess at; there is room between
  // that and the full sentence for a word each.
  const hints = (await drive(120, 40, { armed: true })).lines.find((l) => /\br .*\bq /.test(l))!;
  expect(hints).toBeDefined();
  expect(hints).toMatch(/fill|quote/);
  expect(hints).toMatch(/pnl|wallet/);
}, 60_000);
