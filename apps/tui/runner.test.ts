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

test("an intent reaches the child on stdin, where ps cannot see it", async () => {
  // The env file is no longer sourced by a shell: the signing child opens it and reads the one
  // variable it wants. What the runner has to carry now is the intent, and it goes on stdin —
  // arguments are visible to every user on the machine, and an intent names amounts and addresses.
  const intent = JSON.stringify({ kind: "fill", chainId: 11155111, amount: "150000", isAToB: true });
  const result = await run({ cmd: ["sh", "-c", "cat"], cwd: dir, stdin: intent });

  expect(result.exitCode).toBe(0);
  expect(result.tail).toContain("150000");
});

test("a fill's command carries no amount and no key in its arguments", () => {
  const fill = buildActions(envPath).find((a) => a.key === "f")!.command!;
  expect(fill.cmd.join(" ")).not.toContain("150000");
  expect(fill.cmd.join(" ")).not.toContain(SECRET);
  expect(fill.stdin).toContain("150000");
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
