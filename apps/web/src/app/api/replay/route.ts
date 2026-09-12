import { serveSeed } from "@/lib/seed-route";

/**
 * The recorded replay, served from the committed seed.
 *
 * A route rather than an import so that the boundary exists: swapping the recording for a live read
 * later is this file and nothing else. It is also why the demo cannot fail — there is no indexer
 * between a judge and the screen.
 */
export async function GET(request: Request) {
  return serveSeed("replay.json", request);
}
