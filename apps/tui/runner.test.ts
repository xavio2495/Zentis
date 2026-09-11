import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, summarise } from "./src/runner.js";
import { buildActions } from "./src/actions.js";

const SECRET = "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface";
const dir = mkdtempSync(join(tmpdir(), "zentis-runner-"));
const envPath = join(dir, "operator.env");
writeFileSync(envPath, `TAKER_PRIVATE_KEY=${SECRET}\n1INCH_API_KEY=leading-digit-name\n`);

test("a child's output comes back as a tail, and its exit code is reported as it is", async () => {
  const result = await run({
    cmd: ["sh", "-c", "echo one; echo two; echo three; echo four; exit 3"],
    cwd: dir,
  });
  expect(result.exitCode).toBe(3);
  expect(result.tail).toContain("four");
  expect(result.tail).not.toContain("one"); // only the last few lines survive
});

test("the extra environment reaches the child, and the parent's PATH still does", async () => {
  const result = await run({
    cmd: ["sh", "-c", "echo $FILL_AMOUNT; command -v sh > /dev/null && echo path-ok"],
    cwd: dir,
    env: { FILL_AMOUNT: "150000" },
  });
  expect(result.exitCode).toBe(0);
  expect(result.tail).toContain("150000");
  expect(result.tail).toContain("path-ok");
});

test("the env file is sourced in the child and skips the name a shell cannot take", async () => {
  // The real fill command's shell, with everything after the sourcing prologue swapped for an echo:
  // this asserts the sourcing mechanism without sending anything. `1INCH_API_KEY` must be skipped
  // rather than fatal.
  const fill = buildActions(envPath).find((a) => a.key === "f")!.command!;
  // Plain `$VAR`, not a bash substring: `sh` is dash here, and the real command's shell has to be
  // POSIX for the same reason.
  const shell = fill.cmd[2]!.replace(/set -e;.*$/, 'echo "sourced=$TAKER_PRIVATE_KEY"');
  const result = await run({ cmd: ["sh", "-c", shell, "sh", envPath], cwd: dir });

  expect(result.exitCode).toBe(0);
  expect(result.tail).toContain(`sourced=${SECRET}`); // the child got the key
  expect(result.tail).not.toContain("command not found"); // the digit-led name did not break sourcing
});

test("this process never reads the env file, so the key is not in its own environment", () => {
  buildActions(envPath);
  expect(process.env["TAKER_PRIVATE_KEY"]).toBeUndefined();
  for (const action of buildActions(envPath)) {
    expect(JSON.stringify(action.command?.env ?? {})).not.toContain(SECRET);
  }
});

test("a clean exit is called finished, not succeeded", async () => {
  const action = buildActions(envPath).find((a) => a.key === "r")!;
  const done = summarise(action, { exitCode: 0, tail: "" });
  // The simulator exits zero even when the forwarder rejected the report, so the console reports
  // that the command ended and points at the evidence rather than vouching for the write.
  expect(done).toContain("finished");
  expect(done).not.toContain("succeeded");
  expect(summarise(action, { exitCode: 1, tail: "boom" })).toContain("boom");
});

// Torn down after the suite, not at import: a top-level rmSync runs before the async tests do.
afterAll(() => rmSync(dir, { recursive: true, force: true }));
