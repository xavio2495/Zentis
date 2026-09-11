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
      // The inner quotes are escaped for the shell, not merely written: unescaped, the shell eats
      // them and gcloud receives `textPayload:rc=`, which it rejects with "Unparseable filter:
      // syntax error … token '='" and refuses the whole read. Seen live on 2026-09-11.
      `gcloud logging read "resource.type=cloud_run_job AND ` +
        `labels.\\"run.googleapis.com/execution_name\\"=\\"$EXEC\\" AND textPayload:\\"rc=\\"" ` +
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

/**
 * Which publisher this console can reach, if any.
 *
 * Republishing is the operator's: the workflows run on their own every five minutes, and a reader
 * who cannot reach a publisher has no use for a key that would ask one to run. Shown as disabled it
 * is still a key they will press, and it teaches them the console is holding something back — which
 * it is not, since filling and pushing with their own keys are theirs.
 */
export type PublisherMode = "cloud" | "local" | "none";

export function publisherMode(
  envFile: string | null,
  repo: string | null,
  gcpProject: string | undefined = process.env["ZENTIS_GCP_PROJECT"],
): PublisherMode {
  if (gcpProject !== undefined && gcpProject !== "") return "cloud";
  // A checkout on its own is not a publisher: `cre` signs with the key in the env file.
  return repo !== null && envFile !== null ? "local" : "none";
}

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
 * How this program re-invokes itself.
 *
 * Compiled, the binary is its own interpreter, so the signing child is `<binary> sign`. Run from
 * source it is `bun src/main.tsx sign`. Either way the child is *this* program: there is no second
 * tool to install, and nothing on a stranger's device to be missing.
 */
export function selfCommand(subcommand: string): string[] {
  const script = process.argv[1];
  const compiled = script === undefined || script.startsWith("/$bunfs") || script === process.execPath;
  return compiled ? [process.execPath, subcommand] : [process.execPath, script, subcommand];
}

/**
 * A fill, signed by a child of this binary.
 *
 * The order and its taker traits are not built here or there: they come from the `fill` block
 * recorded beside each deployment, produced by the contract's own builders and written only after
 * the router's hash of the rebuilt order matched the shipped strategy on chain.
 *
 * The intent goes on the child's stdin. Arguments are visible in `ps` to every user on the machine,
 * and an intent names the amount, the side and which key to use.
 */
function fillCommand(envFile: string, fill: FillParams): ActionCommand {
  return {
    cmd: selfCommand("sign"),
    cwd: process.cwd(),
    env: { ZENTIS_ENV: envFile },
    stdin: JSON.stringify({
      kind: "fill",
      chainId: fill.leg.chainId,
      amount: String(fill.amountRaw),
      isAToB: fill.isAToB,
    }),
  };
}

/**
 * What the router says it would do, read in this process.
 *
 * It was `cast call`; it is an `eth_call` through the viem the binary already carries. A static
 * call is what `asView()` provides in Solidity, so this is the quote path the contracts require
 * rather than a second opinion — and it needs no key, so it answers watch-only, and no external
 * tool, so it answers on a device that has only this binary.
 */
export function quoteAvailability(leg: LegConfig): string | null {
  return leg.fill === null
    ? `no fill bytes recorded for ${leg.name}, so this console cannot build the order`
    : null;
}

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
  const mode = publisherMode(envFile, repo, gcpProject);
  const cloud = mode === "cloud";
  const publishCommand = (workflow: "fast" | "slow"): ActionCommand =>
    cloud ? cloudCommand(workflow, gcpProject!) : creCommand(workflow, envFile!, repo!);
  // Both reasons are real and either alone is enough, so the missing repository is named first:
  // it is the one the operator can fix without going to look for a key.
  const blocked = repo === null ? NO_REPO : envFile === null ? NO_ENV : null;
  const blocker = repo === null ? ("repo" as const) : envFile === null ? ("env" as const) : null;
  const runnable = repo !== null && envFile !== null;
  // Built separately, because with no publisher they are not disabled — they are not there.
  const republishing: Action[] =
    mode === "none"
      ? []
      : [
          {
            key: "r",
            blocker: null,
            label: "republish fast",
            short: "fast",
            disabledReason: null,
            command: publishCommand("fast"),
            describe: cloud
              ? "asks the cloud publisher to run the fast workflow now, ahead of its own schedule"
              : "runs the fast workflow against the testnets and broadcasts its report",
          },
          {
            key: "s",
            blocker: null,
            label: "republish slow",
            short: "slow",
            disabledReason: null,
            command: publishCommand("slow"),
            describe: cloud
              ? "asks the cloud publisher to run the slow workflow now: spread, markout and the boundary"
            : "runs the slow workflow: spread, markout and the boundary",
          },
        ];

  return [
    ...republishing,
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
 * A top-up, signed by a child of this binary.
 *
 * It was three `cast` invocations in a shell. Foundry is a developer toolchain and a stranger's
 * device will not have it, so the calls moved into the signing child with everything else: wrap when
 * the wallet's free balance is short, approve `topUp + wantedB` — the approval has to cover the
 * settlement after the push as well as the push itself — then Aqua's own `push`.
 *
 * The amounts are computed once, in `pushPlan`, and carried in the intent rather than recomputed on
 * the other side of a process boundary where they could differ.
 */
export function buildPushAction(
  envFile: string | null,
  push: { leg: LegConfig; plan: PushPlan },
): Action {
  const { leg, plan } = push;
  const blocked = envFile === null ? NO_ENV : null;
  const token = leg.tokenB;
  const size = decimalOf(plan.topUpB, token.decimals);
  return {
    key: "",
    short: "push",
    blocker: envFile === null ? "env" : null,
    label: `push ${size} ${token.symbol} to ${leg.name.replace(/-sepolia$/, "")}`,
    disabledReason: blocked,
    command:
      blocked === null
        ? {
            cmd: selfCommand("sign"),
            cwd: process.cwd(),
            env: { ZENTIS_ENV: envFile! },
            stdin: JSON.stringify({
              kind: "push",
              chainId: leg.chainId,
              amount: String(plan.topUpB),
              approval: String(plan.approval),
              wrap: String(plan.wrap),
              needsApproval: plan.needsApproval,
              keyName: "CRE_ETH_PRIVATE_KEY",
            }),
          }
        : null,
    describe:
      `tops this leg up to the published mid: ${plan.wrap > 0n ? "wraps, " : ""}` +
      `${plan.needsApproval ? "approves for the push and the settlement after it, " : ""}then pushes`,
  };
}

/**
 * The approval a fill settles against.
 *
 * Aqua pulls the taker's side at settlement, so a fill whose approval is short reverts on the
 * approval rather than on the price — which reads as the quote being wrong. This is the one thing
 * that has to happen between funding a wallet and taking a quote with it.
 */
export function buildApproveAction(
  envFile: string | null,
  approve: { leg: LegConfig; amountRaw: bigint },
): Action {
  const { leg, amountRaw } = approve;
  const spender = leg.fill?.router ?? leg.app;
  const blocked = envFile === null ? NO_ENV : null;
  return {
    key: "",
    short: "approve",
    blocker: envFile === null ? "env" : null,
    label: `approve ${decimalOf(amountRaw, leg.tokenA.decimals)} ${leg.tokenA.symbol} on ${leg.name.replace(/-sepolia$/, "")}`,
    disabledReason: blocked,
    command:
      blocked === null
        ? {
            cmd: selfCommand("sign"),
            cwd: process.cwd(),
            env: { ZENTIS_ENV: envFile! },
            stdin: JSON.stringify({
              kind: "approve",
              chainId: leg.chainId,
              token: leg.tokenA.address,
              spender,
              amount: String(amountRaw),
            }),
          }
        : null,
    describe: `lets the router pull ${leg.tokenA.symbol} from this wallet when a fill settles`,
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
    // Null where there is no publisher to ask: the command line says so in its own words rather than
    // offering an action that would be refused.
    republish: (workflow: "fast" | "slow"): Action | null =>
      buildActions(envFile, repo).find((a) => a.label === `republish ${workflow}`) ?? null,
    // No repository in its arguments: a push is three `cast` calls the binary makes itself.
    push: (push: { leg: LegConfig; plan: PushPlan }): Action => buildPushAction(envFile, push),
    approve: (approve: { leg: LegConfig; amountRaw: bigint }): Action => buildApproveAction(envFile, approve),
  };
}
