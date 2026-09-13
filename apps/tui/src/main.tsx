#!/usr/bin/env node
import { homedir } from "node:os";
import { render } from "ink";
import { App } from "./App.js";
import { buildActions, commandActions, findRepoRoot, publisherMode, selfCommand } from "./actions.js";
import { rememberEnvPath, resolveEnvPath } from "./wallet-file.js";
import { fixedStore } from "../sandbox/state.js";
import { fakeSnapshot } from "../sandbox/world.js";
import { run, summarise } from "./runner.js";
import type { Action } from "./action-types.js";
import { parseTxLog } from "./txlog.js";
import { appendTxLog, readTxLog, txlogPath } from "./txlog-file.js";
import { RECORDED_TXLOG } from "./txlog-fixture.js";

/**
 * The operator console.
 *
 * Two entry points. `zentis` is the operator's: it takes `ZENTIS_ENV`, a *path* to a private env
 * file, and hands that path to the child processes the actions run. The file is never opened here,
 * so the console holds no key and can print none.
 *
 * `zentis watch` is the read-only one, and it drops the env file whatever the environment says. That
 * is what the site serves, and a mode that became signing-capable because a file happened to be on
 * disk beside it would be a mode nobody could safely publish.
 */
/**
 * The alternate screen buffer.
 *
 * Launched from a shell the prompt occupies row 0, so a frame sized to the terminal's height pushes
 * its own first row — the status line, and the first card's title — off the top. Reserving another
 * row would work and would also waste one; entering the alternate buffer removes the prompt from the
 * question entirely, which is what every full-screen TUI does. It also leaves scrollback untouched
 * on exit, so quitting the console does not bury whatever the operator was reading before it.
 */
const ALTERNATE_ON = "\u001b[?1049h\u001b[H\u001b[2J";
const ALTERNATE_OFF = "\u001b[?1049l";

const usingAlternate = process.stdout.isTTY === true;
if (usingAlternate) process.stdout.write(ALTERNATE_ON);
const leaveAlternate = () => {
  if (usingAlternate) process.stdout.write(ALTERNATE_OFF);
};
// Covers a clean exit, ctrl-c, and a terminal that goes away: leaving the alternate buffer behind
// would leave the shell drawing into a screen the user cannot scroll.
process.on("exit", leaveAlternate);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    leaveAlternate();
    process.exit(0);
  });
}

/**
 * `zentis sign` — the signing child, and the only part of this program that reads a key.
 *
 * It runs before anything renders: the intent arrives on stdin, the child signs and sends, prints a
 * hash and a status, and exits. The interactive process spawns it and reads those lines back, so the
 * key exists only in a process that has no terminal and no screen.
 */
const argument = process.argv.slice(2)[0];

/**
 * `zentis --version` — what an installer asks, and what a bug report should carry.
 *
 * The tag and commit are compiled in by the release build; from source there is no tag, and saying
 * "dev" is more honest than inventing one.
 */
if (argument === "--version" || argument === "-v") {
  // Dot access on purpose: the release build inlines this with `bun build --define
  // process.env.ZENTIS_VERSION=...`, and a define only matches a dotted identifier, never a
  // string index. The first tagged release shipped reporting "dev" for exactly that reason.
  process.stdout.write(`${process.env.ZENTIS_VERSION ?? "dev"}\n`);
  process.exit(0);
}

/** `zentis update` — the same one-line install, run again. */
if (argument === "update") {
  const child = Bun.spawnSync({
    cmd: ["sh", "-c", "curl -fsSL https://zentis-eth.vercel.app/install.sh | bash"],
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(child.exitCode ?? 1);
}

if (argument === "sign") {
  const { signMain } = await import("./sign.js");
  const stdin = await new Response(Bun.stdin.stream()).text();
  process.exit(await signMain(stdin, process.env["ZENTIS_ENV"] ?? null));
}

const watchOnly = process.argv.slice(2).includes("watch");

/**
 * A terminal, or one line saying so.
 *
 * Ink arms raw mode on start, and without a tty that throws "Raw mode is not supported on the
 * current process.stdin" with a React stack under it — which tells a reader that the console is
 * broken rather than that it is in the wrong place. A service manager, a CI step and a pipe all
 * arrive here.
 */
if (!process.stdin.isTTY) {
  process.stderr.write("zentis needs a terminal; run it from a shell, or `zentis watch` for one frame\n");
  process.exit(2);
}

// What the operator told it, what it remembers, then the wallet it made for them. Nobody sets a
// variable by hand after onboarding.
const envFile = watchOnly ? null : resolveEnvPath();

/**
 * `ZENTIS_FIXTURES=1` runs the console against the recorded moment instead of the network.
 *
 * It is what a test drives — a console started by a test must not be able to spend the maker's
 * indexer allowance — and it is what the demo falls back on if an endpoint is down at the wrong
 * minute. The screen is the real one; only the world behind it is the recording, and the status bar
 * says so rather than letting a recorded moment pass for a live one.
 */
const fixtures = (process.env.ZENTIS_FIXTURES ?? "") !== "";

/**
 * The machine's transaction log: a file this console reads and never writes.
 *
 * What writes it is the signing child, and the taker and rebalance scripts beside it. Under
 * fixtures the recording stands in for it, so the demo's log page shows the transactions that were
 * really sent rather than an empty table.
 */
const txlog = txlogPath();
const readLog = fixtures ? () => parseTxLog(RECORDED_TXLOG) : () => readTxLog(txlog);
const txlogLabel = fixtures ? "recorded transaction log" : txlog.replace(homedir(), "~");

/**
 * A republish, written down where transactions are.
 *
 * It is the one action that does not go through the signing child: the cloud job holds its own key
 * and writes the registry minutes later, so there is no hash here to write down and the line says
 * what was asked and which sequence it answered. `tx` absent is the shape the scripts use for an
 * event rather than a transaction, and this is one.
 */
const noteRepublish = (action: Action, tail: string) => {
  if (fixtures) return;
  const line = tail.split("\n").find((said) => said.includes("seq")) ?? tail.split("\n").pop() ?? "";
  appendTxLog(txlog, {
    at: new Date().toISOString(),
    // Not a chain: the fast workflow writes every leg's registry from one run.
    chain: null,
    chainId: null,
    kind: "republish",
    actor: null,
    tx: null,
    status: null,
    amountIn: null,
    amountOut: null,
    tokenIn: null,
    tokenOut: null,
    note: `${action.label} · ${line.trim()}`.slice(0, 200),
  });
};

const runAction = async (action: Action): Promise<string> => {
  const result = await run(action.command!);
  if (action.label.startsWith("republish") && result.exitCode === 0) noteRepublish(action, result.tail);
  return summarise(action, result);
};

/**
 * The address this console holds a key for, read without reading the key.
 *
 * It asks the signing child, which is the only process that opens the env file. A console that
 * derived the address here would have had the key in its own memory to do it.
 */
const addressOf = (path: string | null): string | null => {
  if (path === null) return null;
  const child = Bun.spawnSync({
    // `selfCommand` knows how to re-invoke this program whether it was compiled or run from source;
    // spelling it out here produced `zentis <path-to-itself> sign`, which quietly started a second
    // console instead of a signer.
    cmd: selfCommand("sign"),
    env: { ...process.env, ZENTIS_ENV: path },
    stdin: new TextEncoder().encode(JSON.stringify({ kind: "address" })),
    stdout: "pipe",
    stderr: "pipe",
  });
  const said = new TextDecoder().decode(child.stdout);
  return /0x[0-9a-fA-F]{40}/.exec(said)?.[0] ?? null;
};

/**
 * A stranger's first run: no key anywhere, and nothing said about watching.
 *
 * The live view is not drawn until they have chosen, because two of the three choices change what
 * it would show — and the third, watching, is one keystroke away.
 */
const onboarding = !watchOnly && envFile === null;

/** Making a wallet, or taking a path: both go to the child, which is where keys are handled. */
const choose = async (choice: "generate" | "existing" | "watch", path?: string): Promise<string | null> => {
  if (choice === "watch") return null;
  if (choice === "existing") {
    // The path is proved before it is remembered, and proving it means the child reading the file
    // and saying which address it holds. This process never opens it: a console that could read a
    // key is a console that could print one.
    if (path === undefined || path.trim() === "") return null;
    const at = path.trim().replace(/^~(?=\/|$)/, homedir());
    const address = addressOf(at);
    if (address === null) return `no key could be read from ${at} — it needs TAKER_PRIVATE_KEY in it`;
    rememberEnvPath(at);
    return `address ${address} · read from ${at} · the key stays in that file and is never shown here`;
  }
  const result = await run({
    cmd: selfCommand("sign"),
    cwd: process.cwd(),
    stdin: JSON.stringify({ kind: "wallet-new" }),
  });
  return result.tail;
};

const makeStore = fixtures
  ? fixedStore({ ...fakeSnapshot("fresh"), caveats: ["recorded fixtures, not live: no source was read"] })
  : undefined;


/**
 * What the console becomes once a wallet exists that did not when it started.
 *
 * Rebuilt here, where it was built the first time: the env path is re-resolved exactly as it is at
 * startup, so a console armed a keystroke ago is the same console as one armed before it drew.
 */
const arm = () => {
  const path = resolveEnvPath();
  if (path === null) return null;
  return {
    actions: buildActions(path),
    commands: commandActions(path),
    publisher: publisherMode(path, findRepoRoot()),
    address: addressOf(path),
  };
};

/**
 * A terminal is a terminal, whatever the surrounding environment calls itself.
 *
 * Ink infers interactivity from `!isInCi && isTTY`. The tty half is right and the CI half is not:
 * an operator who happens to have CI set in their shell — or who runs the console from a job that
 * does — would get a console that draws once and ignores the keyboard, with nothing on screen
 * saying why. This program already refuses to start without a terminal, so the terminal is the
 * whole question.
 */
const app = render(
  <App
    // Only the world behind the screen is recorded. What the console may do is still decided by
    // whether the operator gave it a key, because that is a choice they made and not a test mode.
    actions={buildActions(envFile)}
    runAction={runAction}
    commands={commandActions(envFile)}
    publisher={publisherMode(envFile, findRepoRoot())}
    address={addressOf(envFile)}
    onboarding={onboarding}
    onChoose={choose}
    onArm={arm}
    makeStore={makeStore}
    // The file every process on this machine appends to, read here and never written: the console
    // draws this log, the signing child and the scripts beside it are what write to it.
    readTxLog={readLog}
    txlogPath={txlogLabel}
  />,
  { interactive: process.stdout.isTTY === true },
);
void app.waitUntilExit().then(() => {
  leaveAlternate();
  // Quit means quit. Unmounting Ink does not end the process while a read is still in flight, and a
  // read against an unreachable endpoint retries with backoff — pressing `x` with the network down
  // left the console on screen for as long as those retries took. Nothing here writes anything, so
  // there is nothing in flight worth waiting for.
  process.exit(0);
});
