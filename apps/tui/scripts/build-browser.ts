import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The site spike: Ink bundled for the browser, writing into xterm.js.
 *
 * Ink is a React renderer that emits ANSI, so nothing about it needs a terminal — but it is built
 * for Node, and its dependency graph reaches for Node builtins on paths that never run (error
 * formatting, devtools). Those are shimmed here rather than in `tsconfig.json`, because the node
 * build must keep the real ones.
 *
 * Kept as a script rather than a flag because `--external` is not available to a browser build: an
 * external import in a browser bundle is a bare specifier no browser can resolve.
 */
const SHIMS: Record<string, string> = {
  "react-devtools-core": "src/stubs/react-devtools-core.ts",
  "stack-utils": "src/stubs/stack-utils.ts",
  "node:module": "src/stubs/empty.ts",
  module: "src/stubs/empty.ts",
  "node:process": "src/stubs/node-process.ts",
  "node:os": "src/stubs/node-os.ts",
};

const shimPlugin: import("bun").BunPlugin = {
  name: "zentis-browser-shims",
  setup(build) {
    for (const [specifier, target] of Object.entries(SHIMS)) {
      build.onResolve({ filter: new RegExp(`^${specifier.replace("/", "\\/")}$`) }, () => ({
        path: join(import.meta.dir, "..", target),
      }));
    }
  },
};

const outfile = join(import.meta.dir, "..", "dist", "browser", "console.js");
mkdirSync(dirname(outfile), { recursive: true });

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "..", "src", "browser.tsx")],
  target: "browser",
  outdir: dirname(outfile),
  naming: "console.js",
  plugins: [shimPlugin],
  // Something in the graph still writes bare `global`, which browsers do not define. Aliasing it is
  // safer than shimming another module: it is exactly what the identifier means everywhere else.
  define: { global: "globalThis" },
  minify: true,
});

for (const log of result.logs) console.error(log.message);
if (!result.success) process.exit(1);
console.log(`built ${outfile}`);
