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
        `script -qec ${JSON.stringify(binary)} /dev/null`,
    ],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });

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

    const run = drive(binary, "ab");
    const screen = new TextDecoder().decode(run.stdout);

    expect(screen).toContain("zentis tui");
    expect(screen).toContain("[36m"); // colour survives the compile
    expect(screen).toContain("╭"); // Ink's box borders, i.e. yoga laid the frame out
    expect(screen).toContain("raw input: ab"); // keystrokes arrived and re-rendered
    expect(run.exitCode).toBe(0); // and `x` unwound raw mode cleanly
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
