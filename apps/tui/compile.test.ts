import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBinary } from "./testing/binary.js";

// The binary is the delivery format, so the thing under test is the binary: Ink has to render and
// take raw-mode keystrokes after `bun build --compile`, not just under `bun run`. Driving it needs a
// real tty and a hard deadline, and it must not be able to reach an indexer while it is up — all
// three live in `testing/binary.ts`, because a test that starts a console and leaves it running
// costs the maker its daily allowance.

// Asserted against the first frame, which is the one drawn before any source has answered. That
// keeps the binary's proof — Ink renders, yoga lays out, colour survives, raw mode arms and unwinds
// — free of three chains and three subgraphs having to be up for the suite to pass.
test("the compiled binary renders Ink and reads raw-mode input", () => {
  const dir = mkdtempSync(join(tmpdir(), "zentis-tui-"));
  const binary = join(dir, "zentis");
  try {
    const build = Bun.spawnSync({
      cmd: ["bun", "build", "--compile", "src/main.tsx", "--outfile", binary],
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(new TextDecoder().decode(build.stderr)).not.toContain("error");
    expect(build.exitCode).toBe(0);

    // `watch` rather than a bare start: with no wallet and no env file, a bare start is a stranger's
    // first run and opens the choice instead of the live view. What this test is about is Ink.
    const run = runBinary(binary, { keys: "", args: ["watch"] });
    const screen = run.screen;

    // A frame of its own, with panels in it. Not the loading line: that is the state before any
    // source has answered, and where the endpoints refuse instantly — a CI runner pointed at closed
    // ports — the console is past it before anything looks. The loading screen has its own test,
    // against the sandbox's "loading" scenario, where it is a state rather than a race.
    // Ink drew something of its own: either the first screen, which is the mark and a line saying
    // what is being waited for, or the book once a source has answered. Which of the two a run
    // catches depends on how fast the endpoints refuse — instantly on a runner pointed at closed
    // ports, after a retry or two here — and that is not what this test is about.
    expect(screen).toMatch(/reading the chains|┌ zentis|┌ 1 Sepolia/);
    expect(screen).toContain("[?25l"); // the cursor was hidden, i.e. Ink took the terminal
    expect(screen).not.toContain("Raw mode is not supported"); // stdin arrived as a tty
    expect(screen).toContain("38;2;"); // 24-bit colour survives the compile, given a terminal for it
    expect(run.exitCode).toBe(0); // and `x` unwound raw mode cleanly
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
