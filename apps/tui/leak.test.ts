import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
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

    // `watch`: this temp HOME has no wallet, so a bare start would be onboarding rather than the
    // recorded screen this test is about.
    const { screen, exitCode } = runBinary(binary, { keys: "", args: ["watch"], env: { ZENTIS_FIXTURES: "1" } });
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

test("the binary makes a wallet, prints its address, and never prints its key", () => {
  // Generated in the child that signs, not in the process drawing the screen: the key exists in one
  // process, for as long as it takes to write it to a file only its owner can read.
  const dir = mkdtempSync(join(tmpdir(), "zentis-wallet-"));
  const binary = join(dir, "zentis");
  try {
    const build = Bun.spawnSync({
      cmd: ["bun", "build", "--compile", "src/main.tsx", "--outfile", binary],
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(build.exitCode).toBe(0);

    const run = Bun.spawnSync({
      cmd: [binary, "sign"],
      env: { PATH: dir, HOME: dir },
      stdin: new TextEncoder().encode(JSON.stringify({ kind: "wallet-new" })),
      stdout: "pipe",
      stderr: "pipe",
    });
    const said = `${new TextDecoder().decode(run.stdout)}${new TextDecoder().decode(run.stderr)}`;
    expect(run.exitCode).toBe(0);

    const written = readFileSync(join(dir, ".zentis", "wallet.env"), "utf8");
    const key = written.split("=")[1]!.trim();
    expect(statSync(join(dir, ".zentis", "wallet.env")).mode & 0o777).toBe(0o600);
    // The address is public and is said; the key is neither said nor hinted at.
    expect(said).toContain(privateKeyToAccount(key as `0x${string}`).address);
    expect(said).not.toContain(key);
    expect(said).not.toContain(key.slice(2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 180_000);

test("started without a terminal, the binary says so in one line rather than in a stack", () => {
  const dir = mkdtempSync(join(tmpdir(), "zentis-tty-"));
  const binary = join(dir, "zentis");
  try {
    Bun.spawnSync({
      cmd: ["bun", "build", "--compile", "src/main.tsx", "--outfile", binary],
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    // A pipe, not a pty: this is what a service manager or a CI step gives it. The binary is run
    // directly, with an empty PATH of its own — a shell to redirect through would need one.
    const run = Bun.spawnSync({
      cmd: [binary],
      env: { PATH: dir, HOME: dir },
      stdin: new TextEncoder().encode(""),
      stdout: "pipe",
      stderr: "pipe",
    });
    const said = `${new TextDecoder().decode(run.stdout)}${new TextDecoder().decode(run.stderr)}`;
    expect(said).toContain("needs a terminal");
    expect(said).not.toContain("Raw mode is not supported");
    expect(said.split("\n").filter((l) => l.trim() !== "").length).toBe(1);
    expect(run.exitCode).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 180_000);

test("the binary states its version and exits, which is what an installer asks it", () => {
  const dir = mkdtempSync(join(tmpdir(), "zentis-version-"));
  const binary = join(dir, "zentis");
  try {
    Bun.spawnSync({
      cmd: ["bun", "build", "--compile", "src/main.tsx", "--outfile", binary],
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const run = Bun.spawnSync({ cmd: [binary, "--version"], env: { PATH: dir, HOME: dir }, stdout: "pipe", stderr: "pipe" });
    expect(run.exitCode).toBe(0);
    // "dev" until a release compiles the tag in; either way one line and nothing else.
    expect(new TextDecoder().decode(run.stdout).trim()).toMatch(/^[\w.+()\- ]+$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 180_000);

test("a fresh home reaches the live view as a taker, and the file it wrote is its owner's alone", () => {
  // Plan 11's third gate. A stranger's machine: no wallet, no env file, no variables. One keystroke
  // makes a wallet, one more goes on, and the console is a taker's — a role nobody chose.
  const dir = mkdtempSync(join(tmpdir(), "zentis-first-run-"));
  const binary = join(dir, "zentis");
  try {
    const build = Bun.spawnSync({
      cmd: ["bun", "build", "--compile", "src/main.tsx", "--outfile", binary],
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(build.exitCode).toBe(0);

    // "1" makes the wallet; the window is long enough for the signing child to finish and the page
    // to redraw, because what this asserts is what the reader is shown afterwards.
    const { screen } = runBinary(binary, { keys: "1", waitSeconds: 3, seconds: 20, env: { HOME: dir, ZENTIS_FIXTURES: "1" } });
    expect(screen).toContain("no wallet yet");
    expect(screen).toMatch(/address 0x[0-9a-fA-F]{40}/);

    const walletFile = join(dir, ".zentis", "wallet.env");
    expect(statSync(walletFile).mode & 0o777).toBe(0o600);
    const key = readFileSync(walletFile, "utf8").split("=")[1]!.trim();
    expect(screen).not.toContain(key);
    expect(screen).not.toContain(key.slice(2));

    // Started again, the wallet is found without anyone setting a variable, and the role follows
    // from the address: this one is not the book's maker, so it is a taker's console.
    const second = runBinary(binary, { keys: "d", waitSeconds: 4, seconds: 20, env: { HOME: dir, ZENTIS_FIXTURES: "1" } });
    expect(second.plain).not.toContain("no wallet yet");
    // Matched without the colour codes: a coloured word has escape sequences inside it.
    expect(second.plain).toMatch(/role\s+taker/);
    expect(second.screen).not.toContain(key);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 240_000);
