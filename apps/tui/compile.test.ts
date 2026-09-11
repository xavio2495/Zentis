import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The binary is the delivery format, so the thing under test is the binary: Ink has to
// render and take raw-mode keystrokes after `bun build --compile`, not just under `bun run`.
// Driving it needs a real tty, hence `script`; the keystrokes are delayed because raw mode
// is only armed once the app has mounted.
const drive = (binary: string, keys: string) =>
  Bun.spawnSync({
    cmd: [
      "sh",
      "-c",
      `(sleep 2; printf %s ${JSON.stringify(keys)}; sleep 2; printf x; sleep 2) | ` +
        `script -qec ${JSON.stringify(`stty cols 120 rows 44; ${binary}`)} /dev/null`,
    ],
    stdout: "pipe",
    stderr: "pipe",
    // Colour depth is negotiated with the terminal, and the one a test runner inherits is whatever
    // the machine happens to advertise: the same binary emits 24-bit codes under a truecolour
    // terminal and 256-colour codes without COLORTERM, which made this assertion pass on one
    // machine and fail on the next with nothing about the build having changed. The terminal is
    // therefore stated rather than inherited, and what is proven is that the compile keeps the
    // colour the terminal offers.
    env: { ...process.env, COLORTERM: "truecolor", TERM: "xterm-256color" },
    timeout: 30_000,
  });

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

    const run = drive(binary, "");
    const screen = new TextDecoder().decode(run.stdout);

    expect(screen).toContain("reading three chains"); // the app's own first frame
    expect(screen).toContain("[?25l"); // the cursor was hidden, i.e. Ink took the terminal
    expect(screen).not.toContain("Raw mode is not supported"); // stdin arrived as a tty
    expect(screen).toContain("38;2;"); // 24-bit colour survives the compile, given a terminal for it
    expect(run.exitCode).toBe(0); // and `x` unwound raw mode cleanly
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
