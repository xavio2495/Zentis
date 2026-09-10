import { dirname, join, resolve } from "node:path";
import { ASSUMED_GAINS, BOOK, LEGS, QUOTE_SIZE_A } from "@zentis/console-data";
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

/** The repo root, found from this file rather than from the working directory the binary was run in. */
const REPO = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..");

const NO_ENV =
  "no ZENTIS_ENV file was given, so this cannot sign — start with ZENTIS_ENV=/path/to/private.env";

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

const creCommand = (workflow: "fast" | "slow", envFile: string): ActionCommand => ({
  cmd: ["cre", "-e", envFile, "workflow", "simulate", workflow, "--target", "staging-settings", "--broadcast"],
  cwd: join(REPO, "cre"),
  // The secret *ids* the workflows resolve, at the gains this console already displays. The gains
  // are not the secret — the enclave's copies are — so passing them here reveals nothing the screen
  // does not already footnote.
  env: {
    SECRET_KAPPA_BPS: String(ASSUMED_GAINS.kappaOwnBps),
    SECRET_KAPPA_BOOK_BPS: String(ASSUMED_GAINS.kappaBookBps),
    SECRET_CONGESTION_BPS: "10000",
  },
});

function fillCommand(envFile: string): ActionCommand {
  const leg = LEGS[0]!; // Sepolia: the leg the beat runs on.
  return {
    cmd: [
      "sh",
      "-c",
      sourceThenRun(
        `forge script script/Fill.s.sol --rpc-url "$ZENTIS_RPC" --broadcast`,
      ),
      "sh",
      envFile,
    ],
    cwd: join(REPO, "contracts"),
    env: {
      ZENTIS_RPC: leg.rpcUrl,
      ZENTIS_ROUTER: leg.app,
      REF_REGISTRY: leg.registry,
      MAKER: BOOK.maker,
      TOKEN_A: leg.tokenA.address,
      TOKEN_B: leg.tokenB.address,
      POSITION_ID: BOOK.positionId,
      POSITION_DEADLINE: String(leg.deadline),
      FILL_AMOUNT: String(QUOTE_SIZE_A),
    },
  };
}

export function buildActions(envFile: string | null): Action[] {
  const blocked = envFile === null ? NO_ENV : null;
  return [
    {
      key: "r",
      label: "republish fast",
      disabledReason: blocked,
      command: envFile === null ? null : creCommand("fast", envFile),
      describe: "runs the fast workflow against the testnets and broadcasts its report",
    },
    {
      key: "s",
      label: "republish slow",
      disabledReason: blocked,
      command: envFile === null ? null : creCommand("slow", envFile),
      describe: "runs the slow workflow: spread, markout and the boundary",
    },
    {
      key: "f",
      label: `fill sepolia ${Number(QUOTE_SIZE_A) / 10 ** LEGS[0]!.tokenA.decimals}`,
      disabledReason: blocked,
      command: envFile === null ? null : fillCommand(envFile),
      describe: "takes the Sepolia leg's quote, which is the fill the demo's beat starts from",
    },
    {
      key: "q",
      label: "re-quote",
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
