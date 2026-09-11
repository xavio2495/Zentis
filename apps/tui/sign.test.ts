import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseIntent, readKey, redact } from "./src/sign.js";

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

rmSync(dir, { recursive: true, force: true });
