import { expect, test } from "bun:test";
import { LEGS } from "@zentis/console-data";
import { drive } from "./sandbox/drive.js";
import type { TxLogLine } from "./src/txlog.js";

/**
 * The log, where the feed was.
 *
 * The feed is what the book did; the log is what this console did to it. They belong in the same
 * region because they answer the same question from opposite ends, and a reader wants one or the
 * other rather than half of each.
 *
 * What it reads is a file — `~/.zentis/txlog.jsonl` — and not this process's memory, because the
 * console is not the only thing on the machine sending transactions. The headless taker and the
 * rebalance scripts append to the same file in the same shape, so a fill sent while the console was
 * closed is on the list when it opens.
 */
const sepolia = LEGS[0]!;
const base = LEGS[2]!;

const recorded: TxLogLine[] = [
  {
    at: "2026-09-11T09:22:00Z",
    chain: sepolia.name,
    chainId: sepolia.chainId,
    kind: "fill",
    actor: "0x4887B4695dEe830A341304bFEb14538E2442DD55",
    tx: "0x227404a1cdf976530faee06d6a3d93263d88362b4a283abb6b0064d0bb849e49",
    status: 1,
    amountIn: "150000",
    amountOut: "57941952335277",
    tokenIn: sepolia.tokenA.address,
    tokenOut: sepolia.tokenB.address,
    note: null,
  },
  {
    at: "2026-09-11T09:40:00Z",
    chain: base.name,
    chainId: base.chainId,
    kind: "republish",
    actor: null,
    tx: null,
    status: null,
    amountIn: null,
    amountOut: null,
    tokenIn: null,
    tokenOut: null,
    note: "skipped: gas under floor",
  },
];

test("l puts the log where the feed was, and l again puts the feed back", async () => {
  const feed = await drive(120, 40, {});
  expect(feed.lines.join("\n")).toContain("┌ feed");

  const log = await drive(120, 40, { keys: ["l"], txlog: recorded });
  const text = log.lines.join("\n");
  expect(text).toContain("┌ log");
  expect(text).not.toContain("┌ feed");
  // The columns the scripts and the console agreed on, so both write about the same transaction.
  for (const header of ["when", "chain", "kind", "tx", "status"]) expect(text).toMatch(header);
  expect(text).toMatch(/in → out/);
  expect(log.overflows).toBe(false);

  const back = await drive(120, 40, { keys: ["l", "l"] });
  expect(back.lines.join("\n")).toContain("┌ feed");
}, 60_000);

test("an empty log says so in the words of the thing it is empty of", async () => {
  const frame = await drive(120, 40, { keys: ["l"], txlog: [] });
  expect(frame.lines.join("\n")).toMatch(/no transactions logged yet/);
}, 60_000);

test("the header counts what is there and names the file it came out of", async () => {
  // Which file matters: the operator who wants to know why the page is empty is the operator who
  // needs to be told where the console looked.
  const frame = await drive(120, 40, { keys: ["l"], txlog: recorded });
  const text = frame.lines.join("\n");
  expect(text).toMatch(/1 transaction\b/);
  expect(text).toMatch(/txlog\.jsonl/);
}, 60_000);

test("a recorded transaction is drawn at its own size, on its own chain", async () => {
  const frame = await drive(120, 40, { keys: ["l"], txlog: recorded });
  const text = frame.lines.join("\n");
  expect(text).toMatch(/sepolia/);
  expect(text).toMatch(/fill/);
  expect(text).toMatch(/0\.15/);
  expect(text).toMatch(new RegExp(sepolia.tokenA.symbol));
  // Short, because a sixty-six character hash is most of the region; the detail has the whole one.
  expect(text).toMatch(/0x227404a1/);
  expect(text).not.toContain("0x227404a1cdf976530faee06d6a3d93263d88362b4a283abb6b0064d0bb849e49");
}, 60_000);

test("an event with no transaction keeps its row and says what happened", async () => {
  const frame = await drive(120, 40, { keys: ["l"], txlog: recorded });
  const text = frame.lines.join("\n");
  expect(text).toMatch(/republish/);
  expect(text).toMatch(/gas under floor/);
}, 60_000);

test("the key is offered where every other key is, so nobody has to find it in the help", async () => {
  const frame = await drive(120, 40, {});
  expect(frame.lines.join("\n")).toMatch(/l log/);
}, 60_000);

test("a quote is an action, so the log has it with nothing in the transaction column", async () => {
  // Read-only actions belong in the log too: what the console was asked is a thing done, and a
  // quote that answered is as much a record as a fill that broadcast. It is this console's own
  // memory rather than the file — nothing went on chain, so nothing was appended for the scripts.
  // `esc` closes the command row first: while it is open it has the keyboard, so `l` typed there is
  // a letter of a command and not a key.
  const typed = [":", "q", "u", "o", "t", "e", " ", "s", "e", "p", " ", "0", ".", "1", "ENTER", "ESC", "l"];
  const frame = await drive(120, 40, { keys: typed, txlog: [] });
  const text = frame.lines.join("\n");
  expect(text).toContain("┌ log");
  expect(text).toMatch(/quote/);
}, 60_000);

test("at eighty columns the log still shows a chain, a kind and a hash", async () => {
  // The narrow case is the one that decides the columns: the region is fifty cells wide there, and
  // a table that fits by dropping the hash is a transaction log with no transactions in it.
  const frame = await drive(80, 24, { keys: ["l"], txlog: recorded });
  const text = frame.lines.join("\n");
  expect(text).toMatch(/sepolia/);
  expect(text).toMatch(/fill/);
  expect(text).toMatch(/0x227404a1/);
  expect(frame.overflows).toBe(false);
}, 60_000);

test("a size is given up whole rather than cut in half", async () => {
  // "0.15 USDC → 0.0000579…" is not a shorter way of saying the fill, it is a different number, and
  // a log is read by somebody checking one. When the column cannot hold both sizes it drops the
  // closing one and names the token instead: less said, nothing untrue.
  const frame = await drive(100, 30, { keys: ["l"], txlog: recorded });
  const text = frame.lines.join("\n");
  expect(text).toMatch(/0\.15 USDC/);
  // A hash is shortened on purpose and ends in one of these; a size never does.
  expect(text).not.toMatch(/→ [\d.]+…/);
}, 60_000);
