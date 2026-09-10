import { existsSync } from "node:fs";
import { buildActions, findRepoRoot } from "../src/actions.js";

/**
 * Prints where the console thinks the repository is and whether the directories it would spawn in
 * actually exist.
 *
 * This exists to be compiled. The failure it guards against only appears in a compiled binary — a
 * root derived from `import.meta.url` lands under `/$bunfs`, and the spawn then fails with
 * `ENOENT ... posix_spawn 'cre'`, which names the command and not the working directory. Checking it
 * by pressing the key would mean broadcasting to find out; this asks the same question of the same
 * code and sends nothing.
 */
const root = findRepoRoot();
console.log(`root=${root ?? "(none)"}`);

for (const action of buildActions("/dev/null", root)) {
  const cwd = action.command?.cwd;
  if (cwd === undefined) continue;
  console.log(`${action.key} cwd=${cwd} exists=${existsSync(cwd)}`);
}
