import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LEGS } from "@zentis/console-data";
import { buildActions, buildFillAction, buildPushAction, describeCommand, findRepoRoot } from "./src/actions.js";

// A file shaped like the operator's real one, so that "the console never holds a key" is asserted
// against something a key could actually leak out of.
const SECRET = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const dir = mkdtempSync(join(tmpdir(), "zentis-env-"));
const envPath = join(dir, "operator.env");
writeFileSync(
  envPath,
  `CRE_ETH_PRIVATE_KEY=${SECRET}\nTAKER_PRIVATE_KEY=${SECRET}\n1INCH_API_KEY=not-a-shell-identifier\n`,
);

const REPO = resolve(import.meta.dir, "..", "..");
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

// Torn down after the suite: a top-level rmSync would run before the tests that use the path.
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the repo root is found by walking up from the working directory", () => {
  expect(findRepoRoot(import.meta.dir)).toBe(resolve(import.meta.dir, "..", ".."));
  expect(findRepoRoot(join(import.meta.dir, "src", "components"))).toBe(
    resolve(import.meta.dir, "..", ".."),
  );
});

test("with no root, no command is built against a guess", () => {
  for (const key of ["r", "s", "f"]) {
    const action = buildActions(envPath, null).find((a) => a.key === key)!;
    expect(action.command).toBeNull();
    expect(action.disabledReason).toContain("ZENTIS_REPO");
  }
  // Re-quote reads through the quote path and needs no repository at all.
  expect(buildActions(envPath, null).find((a) => a.key === "q")!.disabledReason).toBeNull();
});

test("the missing repository is named before the missing key, being the easier one to fix", () => {
  expect(buildActions(null, null).find((a) => a.key === "r")!.disabledReason).toContain("ZENTIS_REPO");
  expect(buildActions(null, REPO).find((a) => a.key === "r")!.disabledReason).toContain("ZENTIS_ENV");
});

test("ZENTIS_REPO overrides the search, and a wrong one is ignored rather than obeyed", () => {
  expect(findRepoRoot(dir, REPO)).toBe(REPO);
  // A path that is not the repository is not accepted: the search runs on instead, which here falls
  // through to this module's own location. Obeying it would spawn against a directory with no
  // scripts in it. (Under `bun test` that last resort is a real path; inside the compiled binary it
  // is under /$bunfs and is skipped — which is what `bundle.test.ts` covers.)
  expect(findRepoRoot(dir, join(dir, "nowhere"))).toBe(REPO);
});

test("a typed fill names its own leg, side and size, and those win over the env file's", () => {
  // The parameters are assigned on the command line *after* the file is sourced. `set -a` inside the
  // child exports everything the file assigns, so a stale FILL_AMOUNT in the operator's env file
  // would otherwise quietly replace the size they just typed.
  const leg = LEGS.find((l) => l.name === "base-sepolia")!;
  const action = buildFillAction("/tmp/private.env", "/repo", { leg, amountRaw: 250_000n, isAToB: false });
  expect(action.disabledReason).toBeNull();
  const script = action.command!.cmd.join(" ");
  expect(script).toContain("FILL_AMOUNT=250000");
  expect(script).toContain("FILL_A_TO_B=false");
  expect(script.indexOf("FILL_AMOUNT=")).toBeGreaterThan(script.indexOf("set +a"));
  expect(action.command!.env!["ZENTIS_RPC"]).toBe(leg.rpcUrl);
  expect(action.command!.env!["ZENTIS_ROUTER"]).toBe(leg.app);
  expect(action.label).toContain("base");
});

test("a typed fill with no env file is refused with the same reason the key gives", () => {
  const leg = LEGS[0]!;
  const action = buildFillAction(null, "/repo", { leg, amountRaw: 1n, isAToB: true });
  expect(action.command).toBeNull();
  expect(action.disabledReason).toContain("ZENTIS_ENV");
});

test("a push is three cast calls the binary makes itself, with no repository in sight", () => {
  // The compiled console is handed to an operator who has no checkout: an action that shells out to
  // `python3 scripts/rebalance.py` cannot run there. `cast` is on the PATH beside the binary.
  const leg = LEGS[0]!;
  const action = buildPushAction("/tmp/private.env", {
    leg,
    plan: { topUpB: 3_000_000_000_000_000n, wantedB: 6_000_000_000_000_000n, approval: 9_000_000_000_000_000n, needsApproval: true, wrap: 1_000_000_000_000_000n },
  });
  expect(action.disabledReason).toBeNull();
  expect(action.command!.cwd).not.toContain("contracts");
  const script = action.command!.cmd.join(" ");
  expect(script).not.toContain("rebalance.py");
  expect(script).not.toContain("forge");
  // Wrap, approve, push — in that order, and the approval covers the settlement after the push.
  expect(script.indexOf("deposit()")).toBeLessThan(script.indexOf("approve(address,uint256)"));
  expect(script.indexOf("approve(address,uint256)")).toBeLessThan(script.indexOf("push(address,address,bytes32,address,uint256)"));
  expect(script).toContain("9000000000000000");
  expect(script).toContain(leg.aqua);
  expect(script).toContain(leg.strategyHash);
});

test("the nonce is counted from one read, not inferred three times", () => {
  const action = buildPushAction("/tmp/private.env", {
    leg: LEGS[0]!,
    plan: { topUpB: 1n, wantedB: 2n, approval: 3n, needsApproval: true, wrap: 1n },
  });
  const script = action.command!.cmd.join(" ");
  expect(script).toContain("cast nonce");
  expect(script).toMatch(/--nonce \$N\b/);
  expect(script).toMatch(/--nonce \$\(\(N \+ 1\)\)/);
  expect(script).toMatch(/--nonce \$\(\(N \+ 2\)\)/);
});

test("a push never puts the key on a command line, and the console never reads it", () => {
  const action = buildPushAction("/tmp/private.env", {
    leg: LEGS[0]!,
    plan: { topUpB: 1n, wantedB: 2n, approval: 3n, needsApproval: false, wrap: 0n },
  });
  const script = action.command!.cmd.join(" ");
  // Sourced inside the child, like the fill: the key exists only in that process's environment.
  expect(script).toContain("set -a");
  expect(script).toContain("$CRE_ETH_PRIVATE_KEY");
  expect(action.command!.cmd).toContain("/tmp/private.env");
  // Nothing to wrap and nothing to approve: one transaction, not three.
  expect(script).not.toContain("deposit()");
  expect(script).not.toContain("approve(address,uint256)");
});

test("without an env file a push is refused in the same words as every other signing action", () => {
  const action = buildPushAction(null, {
    leg: LEGS[0]!,
    plan: { topUpB: 1n, wantedB: 2n, approval: 3n, needsApproval: true, wrap: 0n },
  });
  expect(action.command).toBeNull();
  expect(action.disabledReason).toContain("ZENTIS_ENV");
});

test("a fill is the console's own two cast sends, from the recorded bytes, with no checkout", () => {
  // The order and its taker traits come from the deployment record, produced by the Solidity
  // builders and checked against the router's own hash. The console passes them through; rebuilding
  // them here would be a second implementation of the contract's encoder.
  const leg = LEGS.find((l) => l.name === "sepolia")!;
  const action = buildFillAction("/tmp/private.env", null, { leg, amountRaw: 150_000n, isAToB: true });
  expect(action.disabledReason).toBeNull();
  const script = action.command!.cmd.join(" ");
  expect(script).not.toContain("forge");
  expect(script).toContain(leg.fill!.router);
  expect(script).toContain(leg.fill!.swapSignature);
  expect(script).toContain(leg.fill!.takerDataAToB);
  // Approve the router for what goes in, then swap.
  expect(script.indexOf("approve(address,uint256)")).toBeLessThan(script.indexOf(leg.fill!.swapSignature));
  expect(script).toContain("$TAKER_PRIVATE_KEY");
});

test("the other side of the book uses the other side's taker data", () => {
  const leg = LEGS.find((l) => l.name === "sepolia")!;
  const script = buildFillAction("/tmp/private.env", null, { leg, amountRaw: 1n, isAToB: false }).command!.cmd.join(" ");
  expect(script).toContain(leg.fill!.takerDataBToA);
  expect(script).not.toContain(leg.fill!.takerDataAToB);
  // And approves the token that is actually going in.
  expect(script).toContain(leg.tokenB.address);
});

test("a fill quotes first and checks the swap matched it, which is the parity the script asserted", () => {
  const leg = LEGS.find((l) => l.name === "sepolia")!;
  const script = buildFillAction("/tmp/private.env", null, { leg, amountRaw: 150_000n, isAToB: true }).command!.cmd.join(" ");
  expect(script).toContain("cast call");
  expect(script).toContain("quote(");
  // A quote that disagrees with the fill is the one thing this has to catch.
  expect(script).toMatch(/quoted|parity/);
});

test("a leg with no recorded bytes offers no fill, and says that rather than reaching for forge", () => {
  const leg = { ...LEGS[0]!, fill: null };
  const action = buildFillAction("/tmp/private.env", null, { leg, amountRaw: 1n, isAToB: true });
  expect(action.command).toBeNull();
  expect(action.disabledReason).toContain("no fill bytes recorded");
});
