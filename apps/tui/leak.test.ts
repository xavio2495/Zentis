import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OFFLINE_ENV, runBinary } from "./testing/binary.js";

/**
 * A test that starts the console must not leave it running.
 *
 * Seventeen of them once did, each polling the fills subgraphs once a minute, and together they
 * drained two legs' daily indexer allowance to zero. The binary is driven through `script` for a
 * tty, so killing the shell that spawned it is not enough — the process group has to go, whether
 * the console was told to quit or not.
 */
test("a driven binary never outlives its test, even when it is never told to quit", () => {
  const dir = mkdtempSync(join(tmpdir(), "zentis-leak-"));
  const binary = join(dir, "zentis");
  try {
    const build = Bun.spawnSync({
      cmd: ["bun", "build", "--compile", "src/main.tsx", "--outfile", binary],
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(build.exitCode).toBe(0);

    // Driven without the quit key: the console is still up when the window closes.
    runBinary(binary, { keys: "", seconds: 3 });

    const alive = Bun.spawnSync({ cmd: ["pgrep", "-f", binary], stdout: "pipe" });
    expect(new TextDecoder().decode(alive.stdout).trim()).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);

test("the driver points every endpoint at nothing, so a test process cannot reach an indexer", () => {
  // The console reads three subgraphs, three RPCs and the quote service. All seven are overridable,
  // and the driver overrides all seven: a test must not be able to spend the maker's allowance.
  for (const [name, value] of Object.entries(OFFLINE_ENV)) {
    expect(value).toMatch(/127\.0\.0\.1/);
    expect(name).toMatch(/^ZENTIS_/);
  }
  for (const prefix of ["ZENTIS_FILLS_", "ZENTIS_RPC_", "ZENTIS_QUOTE_API"]) {
    expect(Object.keys(OFFLINE_ENV).some((k) => k.startsWith(prefix))).toBe(true);
  }
});

test("the binary can be run against the recorded fixtures, reaching no endpoint at all", () => {
  // A console that renders without the network is what a test drives and what a demo can fall back
  // on. `ZENTIS_FIXTURES=1` serves the recorded moment: the whole screen, no poll, nothing spent.
  const dir = mkdtempSync(join(tmpdir(), "zentis-fixture-"));
  const binary = join(dir, "zentis");
  try {
    const build = Bun.spawnSync({
      cmd: ["bun", "build", "--compile", "src/main.tsx", "--outfile", binary],
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(build.exitCode).toBe(0);

    const { screen, exitCode } = runBinary(binary, { keys: "", env: { ZENTIS_FIXTURES: "1" } });
    // The real screen, not the placeholder: cards, the overall view and the feed.
    expect(screen).toContain("Sepolia");
    expect(screen).toContain("book ");
    expect(screen).not.toContain("reading three chains");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);

test("the binary signs with no Foundry on PATH, and says nothing that carries a key", () => {
  // Plan 11's first gate, as far as a session that must not broadcast can take it: the binary is
  // asked to fill with `cast` absent from PATH and an RPC that refuses, and what it prints is
  // checked. A device without Foundry must fail on the chain, not on a missing tool — and no path
  // out of the child may carry the key.
  const dir = mkdtempSync(join(tmpdir(), "zentis-sign-gate-"));
  const binary = join(dir, "zentis");
  const envFile = join(dir, "private.env");
  const SECRET = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  try {
    const build = Bun.spawnSync({
      cmd: ["bun", "build", "--compile", "src/main.tsx", "--outfile", binary],
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(build.exitCode).toBe(0);
    writeFileSync(envFile, `TAKER_PRIVATE_KEY=${SECRET}\n`, { mode: 0o600 });

    const run = Bun.spawnSync({
      cmd: [binary, "sign"],
      // No Foundry, no anything: the binary's own directory and nothing else on PATH.
      env: { PATH: dir, ZENTIS_ENV: envFile, ZENTIS_RPC_SEPOLIA: "http://127.0.0.1:1", HOME: dir },
      stdin: new TextEncoder().encode(
        JSON.stringify({ kind: "fill", chainId: 11155111, amount: "150000", isAToB: true }),
      ),
      stdout: "pipe",
      stderr: "pipe",
    });
    const said = `${new TextDecoder().decode(run.stdout)}${new TextDecoder().decode(run.stderr)}`;

    // It got as far as the chain: no "command not found", no missing tool.
    expect(said).not.toContain("command not found");
    expect(said).not.toContain("cast");
    // And nothing it said carries the key, in either form.
    expect(said).not.toContain(SECRET);
    expect(said).not.toContain(SECRET.slice(2));
    expect(run.exitCode).not.toBe(0); // the RPC was a closed port, which is the failure being read
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 180_000);
