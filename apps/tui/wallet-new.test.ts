import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAddress } from "viem";
import { createWallet, resolveEnvPath, walletPath } from "./src/wallet-file.js";

/**
 * The wallet a stranger gets on first run.
 *
 * Everything here is about the key never being seen. The console generates it in the same child
 * that signs with it, writes it to a file only its owner can read, and prints the address — which
 * is public — and nothing else. There is no path through this code that returns the key to the
 * process drawing the screen.
 */
const home = mkdtempSync(join(tmpdir(), "zentis-home-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

test("a generated wallet is written where only its owner can read it", () => {
  const created = createWallet(home);
  expect(isAddress(created.address)).toBe(true);
  expect(created.path).toBe(join(home, ".zentis", "wallet.env"));

  const mode = statSync(created.path).mode & 0o777;
  expect(mode).toBe(0o600);
  // The directory too: a key in a world-readable directory is a key with a lock on the wrong door.
  expect(statSync(join(home, ".zentis")).mode & 0o077).toBe(0);

  const written = readFileSync(created.path, "utf8");
  expect(written).toContain("TAKER_PRIVATE_KEY=0x");
  // What the caller gets back is the address, never the key.
  expect(JSON.stringify(created)).not.toContain(written.split("=")[1]!.trim());
});

test("an existing wallet is never overwritten, because that would spend whatever is in it", () => {
  const second = mkdtempSync(join(tmpdir(), "zentis-home2-"));
  createWallet(second);
  expect(() => createWallet(second)).toThrow(/already/i);
  rmSync(second, { recursive: true, force: true });
});

test("the console looks for a key in one order: what it was told, what it remembers, what it made", () => {
  const box = mkdtempSync(join(tmpdir(), "zentis-home3-"));
  // Nothing anywhere: watch-only, and the console says so rather than inventing a path.
  expect(resolveEnvPath(box, undefined)).toBeNull();

  // What it made, once it exists.
  const made = createWallet(box);
  expect(resolveEnvPath(box, undefined)).toBe(made.path);

  // What it remembers: a path the operator gave it on an earlier run.
  const theirs = join(box, "operator.env");
  writeFileSync(theirs, "TAKER_PRIVATE_KEY=0x01\n");
  chmodSync(theirs, 0o600);
  mkdirSync(join(box, ".zentis"), { recursive: true });
  writeFileSync(join(box, ".zentis", "config.json"), JSON.stringify({ envPath: theirs }));
  expect(resolveEnvPath(box, undefined)).toBe(theirs);

  // And what it was told, which wins over both.
  expect(resolveEnvPath(box, "/tmp/explicit.env")).toBe("/tmp/explicit.env");
  rmSync(box, { recursive: true, force: true });
});

test("the wallet's own path is known without creating one", () => {
  expect(walletPath("/home/someone")).toBe("/home/someone/.zentis/wallet.env");
});
