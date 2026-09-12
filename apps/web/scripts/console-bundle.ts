/**
 * The operator's console, copied in as a static asset.
 *
 * `apps/tui` builds an Ink-into-xterm bundle for the browser; this puts the built file where Next
 * can serve it. Copied rather than imported: it is a self-contained ES module that shims Node
 * globals for itself, and running it through this app's bundler would mean maintaining those shims
 * twice.
 *
 * Committed, like the seed, so a deploy of this app alone still has a console to show.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const source = join(import.meta.dir, "..", "..", "tui", "dist", "browser", "console.js");
const target = join(import.meta.dir, "..", "public", "console", "console.js");

if (!existsSync(source)) {
  throw new Error(`no browser bundle at ${source} — run 'bun scripts/build-browser.ts' in apps/tui first`);
}
mkdirSync(join(import.meta.dir, "..", "public", "console"), { recursive: true });
copyFileSync(source, target);
console.log(`copied the console bundle: ${(statSync(target).size / 1024 / 1024).toFixed(2)} MB`);
