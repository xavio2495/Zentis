import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The committed simulation run, served from the same seed.
 *
 * A route rather than an import so that the boundary exists: swapping the recording for a live read
 * later is this file and nothing else. It is also why the demo cannot fail — there is no indexer
 * between a judge and the screen.
 */
export async function GET() {
  const seed = await readFile(join(process.cwd(), "public", "seed", "sim.json"), "utf8");
  return new Response(seed, {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  });
}
