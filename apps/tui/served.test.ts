import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import recordedAt from "../../packages/console-data/fixtures/recorded-at.json" with { type: "json" };

/**
 * The bundle the site serves must be the moment the repository holds.
 *
 * The public console has no network behind it: the recording is compiled *into* the bundle. So a
 * re-recording does not reach the page — the fixtures move, the bundle does not, and the site then
 * shows one moment on `/console` and another on `/sim`. It happened: the console drew a shift of
 * −223 against a published −220 while the replay next door drew −272 against −272 and said the two
 * agreed exactly. A visitor sees the project disagreeing with itself, on the one claim it is making.
 *
 * Nothing in a build catches that, because both files are valid and neither is newer in a way a
 * bundler notices. So it is asserted here, against the number the recording stamps itself with.
 */
const bundles = {
  built: join(import.meta.dir, "dist", "browser", "console.js"),
  served: join(import.meta.dir, "..", "web", "public", "console", "console.js"),
};

test("the served bundle carries the fixtures' own recorded-at, so it is this moment and not an older one", () => {
  // The served copy is the one asserted against, because it is the one that ships: `dist/` is
  // ignored by git, so on a fresh clone it does not exist at all until something builds it.
  expect(existsSync(bundles.served)).toBe(true);
  const served = readFileSync(bundles.served, "utf8");
  // The sandbox's clock is the recording's stamp, compiled in as a literal. If the bundle were
  // built against an earlier recording this number would be the earlier one.
  expect(served).toContain(String(recordedAt.seconds));
});

test("the served copy is the built bundle, byte for byte, wherever one has been built", () => {
  // Two files, one of them a copy, and the copy is what the site serves: copying before rebuilding
  // is a mistake with no symptom until somebody opens the page. This is the only thing that catches
  // a stale copy, since the copy is valid JavaScript either way.
  if (!existsSync(bundles.built)) return;
  expect(readFileSync(bundles.served, "utf8")).toBe(readFileSync(bundles.built, "utf8"));
});

test("publishing the console is one command, so the copy cannot be forgotten", () => {
  const script = join(import.meta.dir, "scripts", "publish-console.ts");
  expect(existsSync(script)).toBe(true);
  const source = readFileSync(script, "utf8");
  // It builds and then copies, in that order: copying first is the mistake this exists to remove,
  // and it is the one that already happened once — the page hung on a bundle from the run before.
  expect(source.indexOf("build-browser")).toBeLessThan(source.indexOf("copyFileSync("));
  // And the site's build runs it, so a deploy cannot ship a bundle from an older recording.
  const web = JSON.parse(readFileSync(join(import.meta.dir, "..", "web", "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  expect(web.scripts["build"]).toContain("publish-console");
});
