#!/usr/bin/env node
import { render } from "ink";
import { App } from "./App.js";
import { buildActions, commandActions } from "./actions.js";
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

const watchOnly = process.argv.slice(2).includes("watch");
const envFile = watchOnly ? null : (process.env.ZENTIS_ENV ?? null);

const runAction = async (action: Action): Promise<string> =>
  summarise(action, await run(action.command!));

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
