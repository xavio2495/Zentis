#!/usr/bin/env node
import { render } from "ink";
import { App } from "./App.js";
import { buildActions, commandActions, findRepoRoot, publisherMode, selfCommand } from "./actions.js";
import { resolveEnvPath } from "./wallet-file.js";
import { fixedStore } from "../sandbox/state.js";
import { fakeSnapshot } from "../sandbox/world.js";
import { run, summarise } from "./runner.js";
import type { Action } from "./action-types.js";

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
  process.stdout.write(`${process.env["ZENTIS_VERSION"] ?? "dev"}\n`);
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

const runAction = async (action: Action): Promise<string> =>
  summarise(action, await run(action.command!));

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
const choose = async (choice: "generate" | "existing" | "watch"): Promise<string | null> => {
  if (choice !== "generate") return null;
  const result = await run({
    cmd: selfCommand("sign"),
    cwd: process.cwd(),
    stdin: JSON.stringify({ kind: "wallet-new" }),
  });
  return result.tail;
};

/**
 * `ZENTIS_FIXTURES=1` runs the console against the recorded moment instead of the network.
 *
 * It is what a test drives — a console started by a test must not be able to spend the maker's
 * indexer allowance — and it is what the demo falls back on if an endpoint is down at the wrong
 * minute. The screen is the real one; only the world behind it is the recording, and the status bar
 * says so rather than letting a recorded moment pass for a live one.
 */
const fixtures = (process.env.ZENTIS_FIXTURES ?? "") !== "";
const makeStore = fixtures
  ? fixedStore({ ...fakeSnapshot("fresh"), caveats: ["recorded fixtures, not live: no source was read"] })
  : undefined;

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
    makeStore={makeStore}
  />,
);
void app.waitUntilExit().then(() => {
  leaveAlternate();
  // Quit means quit. Unmounting Ink does not end the process while a read is still in flight, and a
  // read against an unreachable endpoint retries with backoff — pressing `x` with the network down
  // left the console on screen for as long as those retries took. Nothing here writes anything, so
  // there is nothing in flight worth waiting for.
  process.exit(0);
});
