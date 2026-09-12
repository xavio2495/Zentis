import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Starting the site right after building it.
 *
 * `next build` finishes writing `.next` a moment after the command returns, and a server started in
 * that moment dies on a missing prerender manifest — or, worse, comes up serving a half-written
 * build. It is the shape of thing that only bites when somebody is in a hurry, which on a
 * submission day is everybody: `bun run build && bun run start` is the command anyone types.
 *
 * So `start` waits for the manifest rather than trusting the shell's `&&`.
 */
const web = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const guard = join(import.meta.dir, "..", "scripts", "serve.ts");

test("start goes through the guard rather than straight at next", () => {
  expect(web.scripts["start"]).toContain("serve.ts");
  expect(existsSync(guard)).toBe(true);
});

test("the guard waits for the build's own last file before it serves", () => {
  const source = readFileSync(guard, "utf8");
  expect(source).toContain("prerender-manifest.json");
  // Waits, then starts: checking afterwards would report the race rather than avoid it.
  expect(source.indexOf("prerender-manifest.json")).toBeLessThan(source.indexOf("next\", \"start\""));
  // And gives up rather than hanging forever, because a build that never finishes is also a state.
  expect(source).toMatch(/timeout|deadline|give up|gave up/i);
});

test("the guard passes the operator's arguments through, so a port still works", () => {
  expect(readFileSync(guard, "utf8")).toContain("process.argv.slice(2)");
});
