import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildActions, describeCommand } from "./src/actions.js";

// A file shaped like the operator's real one, so that "the console never holds a key" is asserted
// against something a key could actually leak out of.
const SECRET = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const dir = mkdtempSync(join(tmpdir(), "zentis-env-"));
const envPath = join(dir, "operator.env");
writeFileSync(
  envPath,
  `CRE_ETH_PRIVATE_KEY=${SECRET}\nTAKER_PRIVATE_KEY=${SECRET}\n1INCH_API_KEY=not-a-shell-identifier\n`,
);

const all = (envFile: string | null) => buildActions(envFile);
const find = (envFile: string | null, key: string) => all(envFile).find((a) => a.key === key)!;

test("without an env file every signing action is disabled, and says why", () => {
  for (const key of ["r", "s", "f"]) {
    const action = find(null, key);
    expect(action.disabledReason).not.toBeNull();
    expect(action.disabledReason).toContain("ZENTIS_ENV");
  }
});

test("re-quote works without an env file, because watching needs no key", () => {
  expect(find(null, "q").disabledReason).toBeNull();
  expect(find(envPath, "q").disabledReason).toBeNull();
});

test("with an env file the signing actions are enabled", () => {
  for (const key of ["r", "s", "f"]) {
    expect(find(envPath, key).disabledReason).toBeNull();
  }
});

test("the console passes the env file's path and never its contents", () => {
  for (const action of all(envPath)) {
    const command = action.command;
    if (command === null) continue;
    const printed = [...command.cmd, JSON.stringify(command.env ?? {})].join(" ");
    // The key must appear nowhere: not in an argument, not in the environment the console builds,
    // not in the string the screen prints. Only the path may cross this boundary.
    expect(printed).not.toContain(SECRET);
    expect(printed).not.toContain("PRIVATE_KEY=");
    expect(describeCommand(action)).not.toContain(SECRET);
  }
});

test("the workflows are handed the file with cre's own -e, from the cre directory", () => {
  for (const [key, workflow] of [
    ["r", "fast"],
    ["s", "slow"],
  ] as const) {
    const command = find(envPath, key).command!;
    expect(command.cmd).toContain("-e");
    expect(command.cmd).toContain(envPath);
    expect(command.cmd).toContain(workflow);
    expect(command.cmd).toContain("--broadcast");
    expect(command.cwd).toMatch(/\/cre$/);
  }
});

test("the workflows' secret ids are passed as ids, with their values left to the enclave", () => {
  const env = find(envPath, "r").command!.env!;
  // These are the gains the harness publishes, not secrets: the console already shows them, and
  // the workflow reads the real ones through its own secret store.
  expect(env["SECRET_KAPPA_BPS"]).toBe("10000");
  expect(env["SECRET_KAPPA_BOOK_BPS"]).toBe("5000");
});

test("the fill sources the env file inside the child, skipping names a shell cannot take", () => {
  const command = find(envPath, "f").command!;
  const script = command.cmd.join(" ");
  expect(script).toContain(envPath);
  // Sourcing the file whole fails: a variable whose name starts with a digit is not a shell
  // identifier, and `.` on this file dies with "command not found" before forge ever runs.
  expect(script).toContain("[A-Za-z_][A-Za-z0-9_]*=");
  expect(script).toContain("forge script");
  expect(command.cwd).toMatch(/\/contracts$/);
});

test("the fill is built from the deployment record, not from numbers typed here", () => {
  const env = find(envPath, "f").command!.env!;
  expect(env["ZENTIS_ROUTER"]).toMatch(/^0x[0-9a-fA-F]{40}$/);
  expect(env["REF_REGISTRY"]).toMatch(/^0x[0-9a-fA-F]{40}$/);
  expect(env["TOKEN_A"]).toMatch(/^0x[0-9a-fA-F]{40}$/);
  expect(env["POSITION_ID"]).toMatch(/^0x[0-9a-fA-F]{64}$/);
  expect(Number(env["POSITION_DEADLINE"])).toBeGreaterThan(0);
  expect(Number(env["FILL_AMOUNT"])).toBeGreaterThan(0);
});

test("re-quote runs no child process at all: it re-reads through the quote path", () => {
  expect(find(envPath, "q").command).toBeNull();
});

test("every action describes itself in the operator's own words", () => {
  for (const action of all(envPath)) {
    expect(action.label.length).toBeGreaterThan(0);
    expect(describeCommand(action).length).toBeGreaterThan(0);
  }
});

rmSync(dir, { recursive: true, force: true });
