import { existsSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { ASSUMED_GAINS, BOOK, LEGS, type LegConfig, QUOTE_SIZE_A } from "@zentis/console-data";
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

function fillCommand(envFile: string, repo: string, fill: FillParams): ActionCommand {
  return {
    cmd: [
      "sh",
      "-c",
      sourceThenRun(
        // The size and the side are assigned *after* the file is sourced, so the console's
        // parameters win. `set -a` exports everything the operator's env file assigns, and a stale
        // FILL_AMOUNT left in that file would otherwise quietly replace the amount just typed.
        `FILL_AMOUNT=${fill.amountRaw} FILL_A_TO_B=${fill.isAToB} ` +
          `forge script script/Fill.s.sol --rpc-url "$ZENTIS_RPC" --broadcast`,
      ),
      "sh",
      envFile,
    ],
    cwd: join(repo, "contracts"),
    env: {
      ZENTIS_RPC: fill.leg.rpcUrl,
      ZENTIS_ROUTER: fill.leg.app,
      REF_REGISTRY: fill.leg.registry,
      MAKER: BOOK.maker,
      TOKEN_A: fill.leg.tokenA.address,
      TOKEN_B: fill.leg.tokenB.address,
      POSITION_ID: BOOK.positionId,
      POSITION_DEADLINE: String(fill.leg.deadline),
      FILL_AMOUNT: String(fill.amountRaw),
      FILL_A_TO_B: String(fill.isAToB),
    },
  };
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
  repo: string | null,
  fill: FillParams,
): Action {
  const blocked = repo === null ? NO_REPO : envFile === null ? NO_ENV : null;
  const token = fill.isAToB ? fill.leg.tokenA : fill.leg.tokenB;
  const out = fill.isAToB ? fill.leg.tokenB : fill.leg.tokenA;
  return {
    key: "",
    short: "fill",
    blocker: repo === null ? "repo" : envFile === null ? "env" : null,
    label: fillLabel(fill),
    disabledReason: blocked,
    command: blocked === null ? fillCommand(envFile!, repo!, fill) : null,
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
): Action[] {
  // Both reasons are real and either alone is enough, so the missing repository is named first:
  // it is the one the operator can fix without going to look for a key.
  const blocked = repo === null ? NO_REPO : envFile === null ? NO_ENV : null;
  const blocker = repo === null ? ("repo" as const) : envFile === null ? ("env" as const) : null;
  const runnable = repo !== null && envFile !== null;
  return [
    {
      key: "r",
      blocker,
      label: "republish fast",
      short: "fast",
      disabledReason: blocked,
      command: runnable ? creCommand("fast", envFile!, repo!) : null,
      describe: "runs the fast workflow against the testnets and broadcasts its report",
    },
    {
      key: "s",
      blocker,
      label: "republish slow",
      short: "slow",
      disabledReason: blocked,
      command: runnable ? creCommand("slow", envFile!, repo!) : null,
      describe: "runs the slow workflow: spread, markout and the boundary",
    },
    {
      key: "f",
      blocker,
      label: `fill sepolia ${Number(QUOTE_SIZE_A) / 10 ** LEGS[0]!.tokenA.decimals}`,
      short: "fill",
      disabledReason: blocked,
      // The same builder the typed command uses, at the leg and size the demo's beat runs on.
      command: runnable
        ? fillCommand(envFile!, repo!, { leg: LEGS[0]!, amountRaw: QUOTE_SIZE_A, isAToB: true })
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
 * The factory the command line is given, so a typed command and its key build the same `Action`.
 *
 * `push` has no script in `contracts/script` yet, so it returns null and the row says so rather than
 * spawning something that is not there.
 */
export function commandActions(envFile: string | null, repo: string | null = findRepoRoot()) {
  return {
    fill: (fill: FillParams): Action => buildFillAction(envFile, repo, fill),
    republish: (workflow: "fast" | "slow"): Action => buildRepublishAction(envFile, repo, workflow),
  };
}
