import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Build the public console and put it where the site serves it, in that order.
 *
 * The recording is compiled *into* this bundle — the public console reads no endpoint — so the
 * bundle is only true of the moment it was built against. Re-recording the fixtures does not reach
 * the page, and the failure is silent: both files are valid JavaScript, neither is newer in a way a
 * bundler notices, and the site quietly serves one moment on `/console` and another on `/sim`. That
 * happened, and what it showed was the console disagreeing with the enclave by 3 bps on a round
 * where the two in fact agree exactly.
 *
 * So there is one command, the site's build runs it, and it does the two steps in the order that
 * cannot be got wrong. `served.test.ts` checks the result.
 *
 * Run: `bun run scripts/publish-console.ts` from `apps/tui`.
 */
const here = import.meta.dir;
const built = join(here, "..", "dist", "browser", "console.js");
const served = join(here, "..", "..", "web", "public", "console", "console.js");

const build = Bun.spawnSync({
  cmd: ["bun", "run", join(here, "build-browser.ts")],
  cwd: join(here, ".."),
  stdout: "pipe",
  stderr: "pipe",
});
process.stdout.write(new TextDecoder().decode(build.stdout));
if (build.exitCode !== 0) {
  process.stderr.write(new TextDecoder().decode(build.stderr));
  throw new Error("the browser bundle did not build, so nothing was copied");
}

mkdirSync(dirname(served), { recursive: true });
copyFileSync(built, served);

// Said out loud, because this runs inside a longer build and its whole job is to be current: the
// stamp is the recording's own, and seeing it is how somebody notices it is not today's.
const stamp = (JSON.parse(
  readFileSync(join(here, "..", "..", "..", "packages", "console-data", "fixtures", "recorded-at.json"), "utf8"),
) as { seconds: number }).seconds;
process.stdout.write(`published the console for the moment recorded at ${stamp} (${new Date(stamp * 1000).toISOString()})\n`);
