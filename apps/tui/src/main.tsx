#!/usr/bin/env node
import { render } from "ink";
import { App } from "./App.js";
import { buildActions } from "./actions.js";
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
const watchOnly = process.argv.slice(2).includes("watch");
const envFile = watchOnly ? null : (process.env.ZENTIS_ENV ?? null);

const runAction = async (action: Action): Promise<string> =>
  summarise(action, await run(action.command!));

render(<App actions={buildActions(envFile)} runAction={runAction} />);
