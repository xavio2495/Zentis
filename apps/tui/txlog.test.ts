import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGS } from "@zentis/console-data";
import { record, settle } from "./src/journal.js";
import { mergeRows, parseTxLog, rowsOf } from "./src/txlog.js";
import { appendTxLog, readTxLog, txlogPath } from "./src/txlog-file.js";

/**
 * The transaction log, which is a file and not a memory.
 *
 * Two things write it — this console's signing child, and the scripts beside it — and one thing
 * reads it. That is why it is a file with a shape agreed between them rather than state in the
 * process that happened to send the transaction: a fill sent by the headless taker is as much a
 * thing the operator wants to see afterwards as one they pressed for, and a console restarted
 * between the two should show both.
 *
 * Append-only, by everyone. A reader that rewrites the file races every writer on the machine, and
 * the thing it would race away is the only record of what was sent.
 */
const hash = "0x227404a1cdf976530faee06d6a3d93263d88362b4a283abb6b0064d0bb849e49";
const other = "0x57d0f8e7e38e16b608e1f1f29164b5124ac5c99ce1d7aa987dd6b5ff9ae0c5cd";
const sepolia = LEGS[0]!;

const line = (over: Partial<Parameters<typeof appendTxLog>[1]> = {}) => ({
  at: "2026-09-11T09:22:00Z",
  chain: sepolia.name,
  chainId: sepolia.chainId,
  kind: "fill",
  actor: "0x4887B4695dEe830A341304bFEb14538E2442DD55",
  tx: hash,
  status: 1,
  amountIn: "150000",
  amountOut: "57941952335277",
  tokenIn: sepolia.tokenA.address,
  tokenOut: sepolia.tokenB.address,
  note: null,
  ...over,
});

test("the path is the one the scripts write, and the environment may move it", () => {
  expect(txlogPath({ HOME: "/home/somebody" })).toBe("/home/somebody/.zentis/txlog.jsonl");
  expect(txlogPath({ HOME: "/home/somebody", ZENTIS_TXLOG: "/tmp/elsewhere.jsonl" })).toBe("/tmp/elsewhere.jsonl");
});

test("a line the console cannot read does not take the rest of the file with it", () => {
  // Another process is writing this file as it is read, so a half-written last line is ordinary
  // rather than corruption: the log must show what is there and skip what is not yet.
  const text = [JSON.stringify(line()), "", "{not json", '{"at":"2026-09-11T09:23:00Z"'].join("\n");
  const parsed = parseTxLog(text);
  expect(parsed).toHaveLength(1);
  expect(parsed[0]!.tx).toBe(hash);
});

test("appending keeps what was there, because nobody owns this file alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "zentis-txlog-"));
  const path = join(dir, "txlog.jsonl");
  const theirs = JSON.stringify(line({ tx: other, kind: "approve", amountOut: null, tokenOut: null }));
  writeFileSync(path, `${theirs}\n`);

  appendTxLog(path, line());
  const after = readFileSync(path, "utf8").trim().split("\n");
  expect(after).toHaveLength(2);
  expect(after[0]).toBe(theirs);
  expect(JSON.parse(after[1]!).tx).toBe(hash);
  // One object per line: a pretty-printed entry would break every other reader of this file.
  expect(after[1]).not.toContain("\n");
});

test("appending makes the directory when the console is the first thing on the machine to write one", () => {
  const dir = mkdtempSync(join(tmpdir(), "zentis-txlog-"));
  const path = join(dir, "made", "here", "txlog.jsonl");
  appendTxLog(path, line());
  expect(readTxLog(path)).toHaveLength(1);
});

test("a file that does not exist is an empty log, not an error on the screen", () => {
  expect(readTxLog(join(tmpdir(), "zentis-no-such-log-file.jsonl"))).toEqual([]);
});

test("the newest is at the top, whichever order the file is in", () => {
  const rows = rowsOf([
    line({ at: "2026-09-11T09:22:00Z", tx: hash }),
    line({ at: "2026-09-11T10:00:00Z", tx: other }),
  ]);
  expect(rows[0]!.tx).toBe(other);
  expect(rows[1]!.tx).toBe(hash);
});

test("the amounts are read at the token's own decimals, so a fill is a size and not a raw integer", () => {
  const [row] = rowsOf([line()]);
  expect(row!.kind).toBe("fill");
  expect(row!.status).toBe("ok");
  expect(row!.flow).toContain(sepolia.tokenA.symbol);
  expect(row!.flow).toContain(sepolia.tokenB.symbol);
  expect(row!.flow).toContain("→");
  // 150000 at six decimals is 0.15, not 150000.
  expect(row!.flow).not.toContain("150000");
});

test("a line with no transaction is an event, and says what happened where a hash would be", () => {
  const [row] = rowsOf([line({ tx: null, status: null, amountIn: null, amountOut: null, tokenIn: null, tokenOut: null, kind: "republish", note: "skipped: gas under floor" })]);
  expect(row!.tx).toBeNull();
  expect(row!.status).toBe("event");
  expect(row!.flow).toContain("gas under floor");
  expect(row!.bad).toBe(false);
});

test("a reverted transaction is kept and said, because a log of only the good half is a worse log", () => {
  const [row] = rowsOf([line({ status: 0 })]);
  expect(row!.status).toBe("reverted");
  expect(row!.bad).toBe(true);
});

test("what this console asked for is on the same list, until the file has the answer", () => {
  // The file is written by the child once it has a hash. Between the keystroke and the hash there is
  // nothing in it, and a log that shows nothing while a fill is in flight is a log nobody trusts.
  const asked = record([], { id: 1, atSeconds: 1_789_152_000, source: "key", action: "fill sepolia 0.15 USDC" });
  const running = mergeRows(rowsOf([]), asked);
  expect(running).toHaveLength(1);
  expect(running[0]!.status).toBe("running");
  expect(running[0]!.kind).toBe("fill");
  // The chain column is filled from the words it was asked in, so the row is not a nameless one
  // beside rows that all say where they happened.
  expect(running[0]!.chain).toBe("sepolia");
  expect(running[0]!.flow).toContain("0.15 USDC");

  // Once it has settled with a hash, the file is the record and the console does not say it twice.
  const done = settle(asked, 1, `filled ${hash} success`, false);
  const merged = mergeRows(rowsOf([line()]), done);
  expect(merged).toHaveLength(1);
  expect(merged[0]!.tx).toBe(hash);
});

test("an action that sent nothing keeps its place, because asking is a thing done", () => {
  const asked = record([], { id: 2, atSeconds: 1_789_152_000, source: "command", action: "quote sepolia 0.1 USDC" });
  const done = settle(asked, 2, "0.1 USDC → 0.000039 WETH", false);
  const [row] = mergeRows([], done);
  expect(row!.kind).toBe("quote");
  expect(row!.tx).toBeNull();
  expect(row!.status).toBe("ok");
});

test("nothing in this module can shorten the file", () => {
  // The rule is worth a test rather than a comment: one `writeFileSync` here, added later by
  // somebody fixing something else, silently throws away every line another process wrote.
  const source = readFileSync(new URL("./src/txlog-file.ts", import.meta.url), "utf8");
  expect(source).not.toContain("writeFileSync");
  expect(source).not.toContain("truncate");
  expect(source).toContain('flag: "a"');
});
