import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
