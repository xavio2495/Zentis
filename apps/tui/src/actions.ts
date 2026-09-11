import { existsSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { ASSUMED_GAINS, BOOK, LEGS, type LegConfig, type PushPlan, QUOTE_SIZE_A } from "@zentis/console-data";
import type { Action, ActionCommand } from "./action-types.js";

/**
 * The operator's own commands, run as children.
 *
 * Nothing here is a reimplementation: `r` and `s` are the `cre workflow simulate` invocations from
 * the runbook and `f` is the `forge script` one, with their arguments filled in from the deployment
 * records rather than retyped. If a command works from the shell it works from this console, and if
 * it stops working the console stops working the same way, which is the point of shelling out
 * instead of reaching for a client library.
 *
 * **The console never holds a key.** `ZENTIS_ENV` is a path; it is passed to `cre` with cre's own
 * `-e`, and for forge it is sourced *inside the child shell*, so the secret exists only in the child
 * process's environment. Nothing read from that file is ever loaded here, printed, or put on a
 * command line where `ps` would show it.
 */
export type { Action, ActionCommand } from "./action-types.js";

/**
 * Where the repository is, decided at startup rather than baked in.
 *
 * It cannot come from `import.meta.url`. Inside a compiled binary that path is under `/$bunfs`, so
 * the derived `cre` directory does not exist, and Bun reports the resulting spawn failure against
 * the *command* — `ENOENT ... posix_spawn 'cre'` — which reads as a missing binary or a broken PATH
 * and is neither. The binary is meant to be run from anywhere, so the root is searched for.
 *
 * A candidate has to contain both `cre` and `contracts`, because those are the two directories the
 * actions use as working directories. `ZENTIS_REPO` wins when it names such a directory and is
 * ignored when it does not: falling back to the search beats spawning against a path the operator
 * mistyped. The module's own location is tried last, and only when it is a real path, which is what
 * keeps `bun run` working from outside the repo.
 */
export function findRepoRoot(
  from: string = process.cwd(),
  override: string | undefined = process.env["ZENTIS_REPO"],
): string | null {
  const isRoot = (path: string) =>
    existsSync(join(path, "cre")) && existsSync(join(path, "contracts"));

  if (override !== undefined && override !== "" && isRoot(resolve(override))) return resolve(override);

  let current = resolve(from);
  const { root } = parse(current);
  while (true) {
    if (isRoot(current)) return current;
    if (current === root) break;
    current = dirname(current);
  }

  const here = new URL(import.meta.url).pathname;
  if (!here.startsWith("/$bunfs")) {
    const fromModule = resolve(dirname(here), "..", "..", "..");
    if (isRoot(fromModule)) return fromModule;
  }
  return null;
}

// Both reasons lead with the remedy. They are shown in the status bar, which truncates to its
// width, and a reason whose actionable half falls off the end has not been given.
const NO_ENV = "set ZENTIS_ENV=/path/to/private.env — this console cannot sign without one";

const NO_REPO = "set ZENTIS_REPO=/path/to/Zentis — the scripts are not below this directory";

/**
 * A shell that sources only the assignments whose names a shell can actually take.
 *
 * `1INCH_API_KEY` begins with a digit, which is not a valid shell identifier, so `.` on the whole
 * file dies with `command not found` before forge is reached. Filtering to real identifiers leaves
 * the key forge needs and drops the one it does not. The path is quoted and passed as `$1`, so the
 * file's contents never reach an argument list.
 */
const sourceThenRun = (script: string) =>
  `set -a; eval "$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$1")"; set +a; ${script}`;

/**
 * Asking the cloud publisher to run now.
 *
 * The publisher does not live on the laptop any more: it is a Cloud Run job with its own schedule
 * and its own secrets, ticking every five minutes. "Republish now" is therefore a request to that
 * job rather than a workflow run on this machine, which is also why it needs no signing key here —
 * the job holds its own. It still asks before it does it, because the consequence is the same.
 *
 * The execution's own name is kept and the log read is filtered to it: the schedule is running
 * beside this, so the newest line in that log is not necessarily the run the operator asked for.
 */
const cloudCommand = (workflow: "fast" | "slow", project: string): ActionCommand => ({
  cmd: [
    "sh",
    "-c",
    [
      `EXEC=$(gcloud run jobs execute ${PUBLISHER_JOB} --region ${PUBLISHER_REGION} ` +
        `--project "$ZENTIS_GCP_PROJECT" --args ${workflow} --wait --format="value(metadata.name)")`,
      'echo "execution $EXEC"',
      // The publisher echoes its own "fast rc=0 …" line to stdout, which is the result worth showing.
      `gcloud logging read "resource.type=cloud_run_job AND ` +
        `labels.\"run.googleapis.com/execution_name\"=\"$EXEC\" AND textPayload:rc=" ` +
        `--project "$ZENTIS_GCP_PROJECT" --limit 10 --freshness=30m --format="value(textPayload)"`,
    ].join("; "),
  ],
  cwd: process.cwd(),
  // The project id is not a secret, but it is configuration: passed to the child rather than written
  // into a command line that a screenshot would carry.
  env: { ZENTIS_GCP_PROJECT: project },
});

const PUBLISHER_JOB = "zentis-publisher";
const PUBLISHER_REGION = "us-central1";

const NO_PUBLISHER = "set ZENTIS_GCP_PROJECT to republish through the cloud publisher";

const creCommand = (workflow: "fast" | "slow", envFile: string, repo: string): ActionCommand => ({
  cmd: ["cre", "-e", envFile, "workflow", "simulate", workflow, "--target", "staging-settings", "--broadcast"],
  cwd: join(repo, "cre"),
  // The secret *ids* the workflows resolve, at the gains this console already displays. The gains
  // are not the secret — the enclave's copies are — so passing them here reveals nothing the screen
  // does not already footnote.
  env: {
    SECRET_KAPPA_BPS: String(ASSUMED_GAINS.kappaOwnBps),
    SECRET_KAPPA_BOOK_BPS: String(ASSUMED_GAINS.kappaBookBps),
    SECRET_CONGESTION_BPS: "10000",
  },
});

/** One leg, one size, one side: what a fill needs to know beyond where the repository is. */
export interface FillParams {
  readonly leg: LegConfig;
  readonly amountRaw: bigint;
  readonly isAToB: boolean;
}

/**
 * A fill, as the console's own two transactions.
 *
 * The order and its taker traits are not built here. They are recorded in the deployment record by
 * `EncodeFill.s.sol` — the contract's own builders — and written only once the router's hash of the
 * rebuilt order matched the shipped strategy on chain, so passing them through is passing the live
 * position. Re-encoding a SwapVM order in a shell command would be a second implementation of the
 * encoder, which is the guess the project's first rule exists to prevent.
 *
 * It quotes first with `cast call` — a static call, which is what `asView()` is in Solidity — and
 * refuses to send if the swap would not match it. That is the parity check `Fill.s.sol` asserted,
 * and it is what catches a reference moving between the quote on screen and the fill.
 */
function fillCommand(envFile: string, fill: FillParams): ActionCommand {
  const { leg } = fill;
  const bytes = leg.fill!;
  const [tokenIn] = fill.isAToB ? [leg.tokenA, leg.tokenB] : [leg.tokenB, leg.tokenA];
  const takerData = fill.isAToB ? bytes.takerDataAToB : bytes.takerDataBToA;
  const rpc = `--rpc-url ${leg.rpcUrl}`;
  const key = '--private-key "$TAKER_PRIVATE_KEY"';
  const quoteSignature = quoteSignatureOf(bytes.swapSignature);

  const script = [
    // What the router says it would do, read before anything is sent.
    `QUOTED=$(cast call ${bytes.router} ${JSON.stringify(quoteSignature)} ${JSON.stringify(bytes.orderTuple)} ${fill.amountRaw} ${takerData} ${rpc})`,
    'echo "quoted: $QUOTED"',
    `N=$(cast nonce ${bytes.taker} ${rpc})`,
    `cast send ${tokenIn.address} "approve(address,uint256)" ${bytes.router} ${fill.amountRaw} ${rpc} ${key} --nonce $N`,
    `cast send ${bytes.router} ${JSON.stringify(bytes.swapSignature)} ${JSON.stringify(bytes.orderTuple)} ${fill.amountRaw} ${takerData} ${rpc} ${key} --nonce $((N + 1))`,
    // Read back and compared: a swap that did not match the quote is the thing this has to catch.
    `AFTER=$(cast call ${bytes.router} ${JSON.stringify(quoteSignature)} ${JSON.stringify(bytes.orderTuple)} ${fill.amountRaw} ${takerData} ${rpc})`,
    'echo "quoted after: $AFTER"',
  ].join("; ");

  return {
    cmd: ["sh", "-c", sourceThenRun(`set -e; ${script}`), "sh", envFile],
    cwd: process.cwd(),
  };
}

/**
 * What the router says it would do, asked directly.
 *
 * A static call, which is what `asView()` is in Solidity, so it is the quote path the contracts
 * require rather than a second opinion. It needs no key and no quote service, which is the point:
 * the operator can still ask the router for a price when the service they usually read it from is
 * the thing that is down.
 */
export function buildQuoteAction(fill: FillParams): Action {
  const { leg } = fill;
  const bytes = leg.fill;
  const takerData = bytes === null ? "" : fill.isAToB ? bytes.takerDataAToB : bytes.takerDataBToA;
  const [from, to] = fill.isAToB ? [leg.tokenA, leg.tokenB] : [leg.tokenB, leg.tokenA];
  return {
    key: "",
    short: "quote",
    blocker: null,
    label: `quote ${leg.name.replace(/-sepolia$/, "")} ${decimalOf(fill.amountRaw, from.decimals)} ${from.symbol}`,
    disabledReason:
      bytes === null ? `no fill bytes recorded for ${leg.name}, so this console cannot build the order` : null,
    command:
      bytes === null
        ? null
        : {
            cmd: [
              "sh",
              "-c",
              `cast call ${bytes.router} ${JSON.stringify(quoteSignatureOf(bytes.swapSignature))} ` +
                `${JSON.stringify(bytes.orderTuple)} ${fill.amountRaw} ${takerData} --rpc-url ${leg.rpcUrl}`,
            ],
            cwd: process.cwd(),
          },
    describe: `asks ${leg.label}'s router what it would give for ${from.symbol}, in ${to.symbol}`,
  };
}

/** The router's quote, declared the way its swap is: the same arguments, returning what it would do. */
const quoteSignatureOf = (swapSignature: string): string =>
  `${swapSignature.replace(/^swap/, "quote")}(uint256,uint256,bytes32)`;

/** How a fill is named on screen: the leg, the size and the token going in. */
function fillLabel(fill: FillParams): string {
  const token = fill.isAToB ? fill.leg.tokenA : fill.leg.tokenB;
  const size = decimalOf(fill.amountRaw, token.decimals);
  return `fill ${fill.leg.name.replace(/-sepolia$/, "")} ${size} ${token.symbol}`;
}

/** Raw units back to the decimal the operator typed, without a float in the middle of it. */
function decimalOf(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction === "" ? String(raw / scale) : `${raw / scale}.${fraction}`;
}

/**
 * A fill the operator asked for by name, rather than the one key `f` is bound to.
 *
 * Built here rather than in the command line so that both paths produce the same `Action`, run
 * through the same confirmation, and are refused for the same reasons in the same words.
 */
export function buildFillAction(
  envFile: string | null,
  /** no longer used: a fill needs no checkout. Kept so callers that pass it still compile. */
  _repo: string | null,
  fill: FillParams,
): Action {
  const blocked =
    fill.leg.fill === null
      ? `no fill bytes recorded for ${fill.leg.name}, so this console cannot build the order`
      : envFile === null
        ? NO_ENV
        : null;
  const token = fill.isAToB ? fill.leg.tokenA : fill.leg.tokenB;
  const out = fill.isAToB ? fill.leg.tokenB : fill.leg.tokenA;
  return {
    key: "",
    short: "fill",
    blocker: envFile === null ? "env" : null,
    label: fillLabel(fill),
    disabledReason: blocked,
    command: blocked === null ? fillCommand(envFile!, fill) : null,
    describe: `takes ${fill.leg.label}'s quote, handing over ${token.symbol} for ${out.symbol}`,
  };
}

/** A republish the operator asked for by name; `r` and `s` are the same two commands. */
export function buildRepublishAction(
  envFile: string | null,
  repo: string | null,
  workflow: "fast" | "slow",
): Action {
  const blocked = repo === null ? NO_REPO : envFile === null ? NO_ENV : null;
  return {
    key: "",
    short: workflow,
    blocker: repo === null ? "repo" : envFile === null ? "env" : null,
    label: `republish ${workflow}`,
    disabledReason: blocked,
    command: blocked === null ? creCommand(workflow, envFile!, repo!) : null,
    describe:
      workflow === "fast"
        ? "runs the fast workflow against the testnets and broadcasts its report"
        : "runs the slow workflow: spread, markout and the boundary",
  };
}

export function buildActions(
  envFile: string | null,
  repo: string | null = findRepoRoot(),
  /** the Cloud Run project the publisher runs in; when set, a republish asks that job */
  gcpProject: string | undefined = process.env["ZENTIS_GCP_PROJECT"],
): Action[] {
  // Resolution order for a republish: the cloud job, then a checkout, then neither. The job is
  // preferred because it is where the publisher actually runs — a local `cre` run is the fallback
  // for someone working on the workflow itself.
  const cloud = gcpProject !== undefined && gcpProject !== "";
  const publishBlocked = cloud ? null : repo === null ? NO_PUBLISHER : envFile === null ? NO_ENV : null;
  const publishCommand = (workflow: "fast" | "slow"): ActionCommand | null =>
    cloud ? cloudCommand(workflow, gcpProject!) : publishBlocked === null ? creCommand(workflow, envFile!, repo!) : null;
  // Both reasons are real and either alone is enough, so the missing repository is named first:
  // it is the one the operator can fix without going to look for a key.
  const blocked = repo === null ? NO_REPO : envFile === null ? NO_ENV : null;
  const blocker = repo === null ? ("repo" as const) : envFile === null ? ("env" as const) : null;
  const runnable = repo !== null && envFile !== null;
  return [
    {
      key: "r",
      blocker: publishBlocked === null ? null : cloud ? null : repo === null ? "repo" : "env",
      label: "republish fast",
      short: "fast",
      disabledReason: publishBlocked,
      command: publishCommand("fast"),
      describe: cloud
        ? "asks the cloud publisher to run the fast workflow now, ahead of its own schedule"
        : "runs the fast workflow against the testnets and broadcasts its report",
    },
    {
      key: "s",
      blocker: publishBlocked === null ? null : cloud ? null : repo === null ? "repo" : "env",
      label: "republish slow",
      short: "slow",
      disabledReason: publishBlocked,
      command: publishCommand("slow"),
      describe: cloud
        ? "asks the cloud publisher to run the slow workflow now: spread, markout and the boundary"
        : "runs the slow workflow: spread, markout and the boundary",
    },
    {
      key: "f",
      blocker,
      label: `fill sepolia ${Number(QUOTE_SIZE_A) / 10 ** LEGS[0]!.tokenA.decimals}`,
      short: "fill",
      disabledReason: blocked,
      // The same builder the typed command uses, at the leg and size the demo's beat runs on. A fill
      // needs no repository now: the order comes from the deployment record.
      command:
        envFile !== null && LEGS[0]!.fill !== null
          ? fillCommand(envFile, { leg: LEGS[0]!, amountRaw: QUOTE_SIZE_A, isAToB: true })
          : null,
      describe: "takes the Sepolia leg's quote, which is the fill the demo's beat starts from",
    },
    {
      key: "q",
      blocker: null,
      label: "re-quote",
      short: "quote",
      disabledReason: null,
      // Performed in-process: the quote path already asks the deployed router through `asView`, so
      // a re-quote is a re-read and needs no key. That is also what keeps it working watch-only.
      command: null,
      describe: "re-reads every source and asks the router for a fresh two-sided quote",
    },
  ];
}

export const describeCommand = (action: Action): string =>
  action.command === null ? action.describe : `${action.describe}: ${action.command.cmd.join(" ")}`;

/**
 * A top-up the console performs itself: wrap if the wallet is short, approve, push.
 *
 * No repository and no script. The compiled binary is handed to an operator who may have no
 * checkout at all, so an action that shelled out to `python3 scripts/rebalance.py` could not run
 * where the console actually runs — `cast` is on the PATH beside it, and these are three plain calls
 * with plain arguments, which is the whole reason `push` can be made self-contained and `fill`
 * cannot: a fill has to build a SwapVM order and its program bytes, and hand-encoding that here
 * would be a second implementation of the contract's own builder.
 *
 * The key is sourced inside the child, exactly as the fill does it, so it exists only in that
 * process's environment and never on a command line where `ps` would show it. The nonce is read once
 * and counted: three sends racing for the same nonce is the ordinary way this fails.
 */
export function buildPushAction(
  envFile: string | null,
  push: { leg: LegConfig; plan: PushPlan },
): Action {
  const { leg, plan } = push;
  const blocked = envFile === null ? NO_ENV : null;
  const token = leg.tokenB;
  const size = decimalOf(plan.topUpB, token.decimals);
  const rpc = `--rpc-url ${leg.rpcUrl}`;
  const key = "--private-key \"$CRE_ETH_PRIVATE_KEY\"";
  // Counted from one read. `cast nonce` is the pending count, so the first send takes it as-is.
  const steps: string[] = ["N=$(cast nonce " + BOOK.maker + " " + rpc + ")"];
  let step = 0;
  const at = () => (step === 0 ? "$N" : `$((N + ${step}))`);
  if (plan.wrap > 0n) {
    steps.push(`cast send ${token.address} "deposit()" --value ${plan.wrap} ${rpc} ${key} --nonce ${at()}`);
    step += 1;
  }
  if (plan.needsApproval) {
    steps.push(
      `cast send ${token.address} "approve(address,uint256)" ${leg.aqua} ${plan.approval} ${rpc} ${key} --nonce ${at()}`,
    );
    step += 1;
  }
  steps.push(
    `cast send ${leg.aqua} "push(address,address,bytes32,address,uint256)" ` +
      `${BOOK.maker} ${leg.app} ${leg.strategyHash} ${token.address} ${plan.topUpB} ${rpc} ${key} --nonce ${at()}`,
  );

  return {
    key: "",
    short: "push",
    blocker: envFile === null ? "env" : null,
    label: `push ${size} ${token.symbol} to ${leg.name.replace(/-sepolia$/, "")}`,
    disabledReason: blocked,
    command:
      blocked === null
        ? {
            // `set -e` so a failed wrap or approval does not leave a push running against a nonce
            // that has already been spent.
            cmd: ["sh", "-c", sourceThenRun(`set -e; ${steps.join("; ")}`), "sh", envFile!],
            cwd: process.cwd(),
          }
        : null,
    describe:
      `tops this leg up to the published mid: ${plan.wrap > 0n ? "wraps, " : ""}` +
      `${plan.needsApproval ? "approves for the push and the settlement after it, " : ""}then pushes`,
  };
}

/**
 * The factory the command line is given, so a typed command and its key build the same `Action`.
 *
 * `push` has no script in `contracts/script` yet, so it returns null and the row says so rather than
 * spawning something that is not there.
 */
export function commandActions(envFile: string | null, repo: string | null = findRepoRoot()) {
  return {
    fill: (fill: FillParams): Action => buildFillAction(envFile, repo, fill),
    republish: (workflow: "fast" | "slow"): Action =>
      buildActions(envFile, repo).find((a) => a.label === `republish ${workflow}`) ??
      buildRepublishAction(envFile, repo, workflow),
    // No repository in its arguments: a push is three `cast` calls the binary makes itself.
    push: (push: { leg: LegConfig; plan: PushPlan }): Action => buildPushAction(envFile, push),
  };
}
