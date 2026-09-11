import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LEGS, QUOTE_SIZE_A } from "@zentis/console-data";
import {
  buildActions,
  buildFillAction,
  buildPushAction,
  buildQuoteAction,
  describeCommand,
  findRepoRoot,
} from "./src/actions.js";

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
// No cloud publisher unless a test asks for one: the default reads this machine's environment, and a
// suite that passes or fails on what happens to be exported around it is not a suite.
const all = (envFile: string | null) => buildActions(envFile, findRepoRoot(), "");
const find = (envFile: string | null, key: string) => all(envFile).find((a) => a.key === key)!;

test("without an env file the signing actions that remain are disabled, and say why", () => {
  // The republish keys are not disabled without a publisher: they are not there. The fill is, and
  // it is the one a reader with their own taker key can still arm.
  expect(find(null, "f").disabledReason).toContain("ZENTIS_ENV");
  expect(all(null).find((a) => a.key === "r")).toBeUndefined();
  expect(all(null).find((a) => a.key === "s")).toBeUndefined();
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
  // identifier, and `.` on this file dies with "command not found" before anything runs.
  expect(script).toContain("[A-Za-z_][A-Za-z0-9_]*=");
  // No forge and no repository: the fill is two `cast` sends against bytes the deployment record
  // carries, so the compiled console can take a quote wherever it is run.
  expect(script).toContain("cast send");
  expect(script).not.toContain("forge");
});

test("the fill is built from the deployment record, not from numbers typed here", () => {
  const script = find(envPath, "f").command!.cmd.join(" ");
  const leg = LEGS[0]!;
  expect(script).toContain(leg.fill!.router);
  expect(script).toContain(leg.fill!.orderTuple);
  expect(script).toContain(leg.fill!.takerDataAToB);
  // The size is the book's own quote size, which is configured rather than chosen here.
  expect(script).toContain(String(QUOTE_SIZE_A));
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

test("with no root and no cloud project there is no republish at all, and the rest still works", () => {
  // An empty project is "no cloud publisher": the default would read this machine's environment, and
  // a test that passes or fails on what is exported around it is not a test.
  const actions = buildActions(envPath, null, "");
  expect(actions.find((a) => a.key === "r")).toBeUndefined();
  expect(actions.find((a) => a.key === "s")).toBeUndefined();
  // The fill needs neither a checkout nor a publisher: its order comes from the deployment record.
  expect(actions.find((a) => a.key === "f")!.command).not.toBeNull();
  // Re-quote reads through the quote path and needs nothing at all.
  expect(actions.find((a) => a.key === "q")!.disabledReason).toBeNull();
});

test("a checkout without a key is not a publisher, so nothing is offered on the strength of it", () => {
  // `cre` signs with the key in the env file, so a repository alone cannot republish; and where it
  // cannot, the key is absent rather than disabled.
  expect(buildActions(null, null, "").find((a) => a.key === "r")).toBeUndefined();
  expect(buildActions(null, REPO, "").find((a) => a.key === "r")).toBeUndefined();
});

test("ZENTIS_REPO overrides the search, and a wrong one is ignored rather than obeyed", () => {
  expect(findRepoRoot(dir, REPO)).toBe(REPO);
  // A path that is not the repository is not accepted: the search runs on instead, which here falls
  // through to this module's own location. Obeying it would spawn against a directory with no
  // scripts in it. (Under `bun test` that last resort is a real path; inside the compiled binary it
  // is under /$bunfs and is skipped — which is what `bundle.test.ts` covers.)
  expect(findRepoRoot(dir, join(dir, "nowhere"))).toBe(REPO);
});

test("a typed fill names its own leg, side and size", () => {
  // Nothing is passed through the environment any more, so nothing in the operator's env file can
  // replace what they typed: the leg, the size and the side are in the command itself.
  const leg = LEGS.find((l) => l.name === "base-sepolia")!;
  const action = buildFillAction("/tmp/private.env", null, { leg, amountRaw: 250_000n, isAToB: false });
  expect(action.disabledReason).toBeNull();
  const script = action.command!.cmd.join(" ");
  expect(script).toContain("250000");
  expect(script).toContain(leg.fill!.takerDataBToA);
  expect(script).toContain(leg.rpcUrl);
  expect(script).toContain(leg.fill!.router);
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

test("a typed quote is a static call the console makes itself, needing no key and no service", () => {
  // `cast call` is a static call, which is what `asView()` is in Solidity — the quote path the
  // anti-patterns require. It needs no key, so it works watch-only, and no quote service, so it
  // still answers when that service is the thing that is down.
  const leg = LEGS.find((l) => l.name === "sepolia")!;
  const action = buildQuoteAction({ leg, amountRaw: 150_000n, isAToB: true });
  expect(action.disabledReason).toBeNull();
  const script = action.command!.cmd.join(" ");
  expect(script).toContain("cast call");
  expect(script).toContain("quote(");
  expect(script).toContain(leg.fill!.orderTuple);
  expect(script).not.toContain("cast send");
  expect(script).not.toContain("PRIVATE_KEY");
});

test("a quote for a leg with no recorded bytes says so rather than guessing an order", () => {
  const action = buildQuoteAction({ leg: { ...LEGS[0]!, fill: null }, amountRaw: 1n, isAToB: true });
  expect(action.command).toBeNull();
  expect(action.disabledReason).toContain("no fill bytes recorded");
});

test("with a cloud project set, a republish asks the job to run rather than running cre here", () => {
  // The publisher moved off the laptop: it is a Cloud Run job with its own schedule and its own
  // secrets. "Republish now" is therefore a request to that job, not a workflow run on this machine,
  // and the console needs no repository and no signing key of its own to make it.
  const [fast, slow] = ["fast", "slow"].map(
    (workflow) => buildActions(null, null, "zentis-cg1-2026").find((a) => a.key === (workflow === "fast" ? "r" : "s"))!,
  );
  expect(fast!.disabledReason).toBeNull();
  const script = fast!.command!.cmd.join(" ");
  expect(script).toContain("gcloud run jobs execute zentis-publisher");
  expect(script).toContain("--region us-central1");
  expect(script).toContain("--args fast");
  expect(script).toContain("--wait");
  expect(script).not.toContain("cre ");
  expect(slow!.command!.cmd.join(" ")).toContain("--args slow");
});

test("the console reads the publisher's own line back out of that execution's logs", () => {
  const action = buildActions(null, null, "zentis-cg1-2026").find((a) => a.key === "r")!;
  const script = action.command!.cmd.join(" ");
  // Filtered to the execution it just started: the job ticks on its own every five minutes, so the
  // newest line in that log is not necessarily the run the operator asked for.
  expect(script).toContain("gcloud logging read");
  expect(script).toMatch(/execution/);
  expect(script).toContain("rc=");
});

test("the project is passed to the child rather than written into the command", () => {
  const action = buildActions(null, null, "zentis-cg1-2026").find((a) => a.key === "r")!;
  expect(action.command!.cmd.join(" ")).toContain('"$ZENTIS_GCP_PROJECT"');
  expect(action.command!.env!["ZENTIS_GCP_PROJECT"]).toBe("zentis-cg1-2026");
});

test("without a project a checkout and a key still republish through cre", () => {
  // Resolution order: the cloud job, then a local run for someone working on the workflow itself.
  const local = buildActions(envPath, REPO, "").find((a) => a.key === "r")!;
  expect(local.command!.cmd.join(" ")).toContain("cre");
  expect(buildActions(envPath, null, "").find((a) => a.key === "r")).toBeUndefined();
});

test("the log filter quotes its term, because an unquoted = is a syntax error to gcloud", () => {
  // Run live: `textPayload:rc=` was rejected with "Unparseable filter: syntax error … token '='".
  // The term has to be quoted inside the filter, which means escaped inside the shell string.
  const script = buildActions(null, null, "zentis-cg1-2026").find((a) => a.key === "r")!.command!.cmd.join(" ");
  expect(script).toContain('textPayload:\\"rc=\\"');
  expect(script).not.toMatch(/textPayload:rc=[^"]/);
});

test("a fill is this binary signing for itself, with the intent on stdin and no Foundry anywhere", () => {
  // A stranger's device has the console and nothing else. `cast: command not found` at the moment of
  // the first fill is the wall this removes.
  const leg = LEGS.find((l) => l.name === "sepolia")!;
  const action = buildFillAction("/tmp/private.env", null, { leg, amountRaw: 150_000n, isAToB: true });
  expect(action.disabledReason).toBeNull();
  const command = action.command!;
  expect(command.cmd.join(" ")).not.toContain("cast");
  expect(command.cmd.join(" ")).not.toContain("forge");
  expect(command.cmd).toContain("sign");
  // The intent goes on stdin, never in the arguments: `ps` shows arguments to everyone.
  expect(command.stdin).toBeDefined();
  const intent = JSON.parse(command.stdin!) as { kind: string; chainId: number; amount: string; isAToB: boolean };
  expect(intent.kind).toBe("fill");
  expect(intent.chainId).toBe(leg.chainId);
  expect(intent.amount).toBe("150000");
  expect(intent.isAToB).toBe(true);
  expect(command.cmd.join(" ")).not.toContain("150000");
  // And the child is handed the file's path, as before, never its contents.
  expect(command.env!["ZENTIS_ENV"]).toBe("/tmp/private.env");
});

test("nothing in the console's own source spawns cast for a fill or a quote any more", async () => {
  const source = await Bun.file(new URL("./src/actions.ts", import.meta.url)).text();
  expect(source).not.toContain('"cast call"');
  expect(source).not.toMatch(/cast send \$\{|cast call \$\{/);
});
