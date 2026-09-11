import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGS } from "@zentis/console-data";
import { type Transport, parseTransaction, toFunctionSelector } from "viem";
import { parseIntent, readKey, redact, runIntent } from "./src/sign.js";

/**
 * The one process that holds a key.
 *
 * The interactive console never reads the env file; it hands an intent to a child of the same
 * binary, which reads the key, signs, sends, and prints a hash. The tests that matter here are not
 * about the happy path — they are about what the child says when it fails, because that is where a
 * key escapes: into an error message, a stack, a rejected-request dump.
 */
const dir = mkdtempSync(join(tmpdir(), "zentis-sign-"));
const SECRET = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const keyFile = join(dir, "key.env");
writeFileSync(keyFile, `TAKER_PRIVATE_KEY=${SECRET}\n`);
chmodSync(keyFile, 0o600);

/**
 * A transport that answers rather than asks, recording what it was told to send.
 *
 * The chain is not the subject here: the sequence is. Which calls a push makes, in what order, and
 * against which nonces is what a mocked transport can pin and a live one cannot pin cheaply.
 */
const SELECTORS: Record<string, string> = {
  [toFunctionSelector("deposit()")]: "deposit",
  [toFunctionSelector("approve(address,uint256)")]: "approve",
  [toFunctionSelector("push(address,address,bytes32,address,uint256)")]: "push",
};

const recordingTransport = (sent: string[], nonces: number[]) =>
  ((() => ({
  async request({ method, params }: { method: string; params?: unknown[] }) {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return "0x1";
    if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_blockNumber") return "0x1";
    if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x1", number: "0x1", timestamp: "0x1" };
      if (method === "eth_sendRawTransaction") {
        // A local account signs in-process, so what reaches the transport is the signed transaction
        // itself. Parsing it back is also the strongest form of this assertion: it is what would go
        // on chain, not what was asked for.
        const parsed = parseTransaction((params?.[0] ?? "0x") as `0x${string}`);
        sent.push(SELECTORS[(parsed.data ?? "").slice(0, 10)] ?? "unknown");
        if (parsed.nonce !== undefined) nonces.push(Number(parsed.nonce));
        return `0x${"11".repeat(32)}`;
      }
    if (method === "eth_getTransactionReceipt") {
      return { status: "0x1", transactionHash: `0x${"11".repeat(32)}`, blockNumber: "0x1" };
    }
    if (method === "eth_call") return "0x";
    if (method === "eth_sendTransaction") {
      const tx = (params?.[0] ?? {}) as { data?: string; nonce?: string };
      sent.push(SELECTORS[(tx.data ?? "").slice(0, 10)] ?? "unknown");
      if (tx.nonce !== undefined) nonces.push(Number(BigInt(tx.nonce)));
      return `0x${"11".repeat(32)}`;
    }
      return null;
    },
  })) as unknown as Transport);

test("an intent arrives as data, and a malformed one is refused rather than guessed at", () => {
  const parsed = parseIntent(JSON.stringify({ kind: "approve", chainId: 11155111, token: "0x01", spender: "0x02", amount: "5" }));
  expect(parsed.kind).toBe("approve");
  expect(() => parseIntent("not json")).toThrow(/intent/i);
  expect(() => parseIntent(JSON.stringify({ kind: "mystery" }))).toThrow(/mystery|unknown/i);
});

test("the key is read from the file's own variable, and a missing one says which", () => {
  const path = join(dir, "good.env");
  writeFileSync(path, `TAKER_PRIVATE_KEY=${SECRET}\n1INCH_API_KEY=not-a-shell-identifier\n`);
  chmodSync(path, 0o600);
  expect(readKey(path, "TAKER_PRIVATE_KEY")).toBe(SECRET);

  const missing = join(dir, "empty.env");
  writeFileSync(missing, "SOMETHING_ELSE=1\n");
  chmodSync(missing, 0o600);
  try {
    readKey(missing, "TAKER_PRIVATE_KEY");
    throw new Error("should have refused");
  } catch (cause) {
    // Names the variable it wanted, never the file's contents.
    expect(String(cause)).toContain("TAKER_PRIVATE_KEY");
    expect(String(cause)).not.toContain("SOMETHING_ELSE");
  }
});

test("a file anyone can read is refused, because a key in it is already spent", () => {
  const loose = join(dir, "loose.env");
  writeFileSync(loose, `TAKER_PRIVATE_KEY=${SECRET}\n`);
  chmodSync(loose, 0o644);
  expect(() => readKey(loose, "TAKER_PRIVATE_KEY")).toThrow(/permission|mode|600/i);
});

test("whatever the child says, a key is never in it", () => {
  // Every path out of this process goes through `redact`, because the ways a key escapes are the
  // ways nobody planned: a provider's error quoting the request, a stack with an argument in it.
  const shouted = `failed to send: {"from":"0x…","key":"${SECRET}"} and again ${SECRET.slice(2)}`;
  const safe = redact(shouted, SECRET);
  expect(safe).not.toContain(SECRET);
  expect(safe).not.toContain(SECRET.slice(2));
  expect(safe).toContain("failed to send");
  expect(safe).toMatch(/redacted/);
});

test("redaction holds even when the key is not the one that was passed in", () => {
  // Any 32-byte hex that looks like a key goes, whoever it belongs to: a child that leaked a key
  // it had not been given would leak it just as completely.
  const other = "0x" + "ab".repeat(32);
  expect(redact(`boom ${other}`, SECRET)).not.toContain(other);
});

// After the tests, not while the module is being read: at module scope this ran before the first
// test did, and every one of them then failed on a directory that was already gone.
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a push is wrap, approve and push, in that order and against one counted nonce", async () => {
  // The transport records what it is asked to do rather than doing it, which is how the sequence is
  // pinned without a chain: the order of these three is the whole correctness of a top-up.
  const sent: string[] = [];
  const nonces: number[] = [];
  await runIntent(
    {
      kind: "push",
      chainId: LEGS[0]!.chainId,
      amount: "1000",
      approval: "3000",
      wrap: "500",
      needsApproval: true,
      keyName: "TAKER_PRIVATE_KEY",
    },
    keyFile,
    () => undefined,
    recordingTransport(sent, nonces),
  );
  expect(sent).toEqual(["deposit", "approve", "push"]);
  // One read, then counted: three sends racing for the same nonce is the ordinary way this fails.
  expect(nonces).toEqual([7, 8, 9]);
});

test("a push with nothing to wrap and an allowance that covers it is one transaction", async () => {
  const sent: string[] = [];
  await runIntent(
    { kind: "push", chainId: LEGS[0]!.chainId, amount: "1000", approval: "3000", wrap: "0", needsApproval: false, keyName: "TAKER_PRIVATE_KEY" },
    keyFile,
    () => undefined,
    recordingTransport(sent, []),
  );
  expect(sent).toEqual(["push"]);
});
