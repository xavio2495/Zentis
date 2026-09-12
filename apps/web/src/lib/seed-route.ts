import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Serving a committed seed file, in a way a cache cannot hold stale.
 *
 * These routes used to promise `max-age=3600`, and the failure that hides behind it is silent and
 * precisely the wrong one: the moment gets re-recorded — to replace a carried slow round with one
 * where the console reproduces the enclave's shift exactly — and a tab opened an hour before keeps
 * drawing the old one, alarm line and all. An ordinary reload does not shift it. Only a hard reload
 * does, and nobody hard-reloads a page that looks like it is working.
 *
 * So: revalidate every time, and make revalidating cheap. The ETag is the seed's own content, so an
 * unchanged file costs a 304 and no body, and a changed one reaches the reader on their next
 * request rather than within the hour.
 */
export async function serveSeed(name: string, request: Request): Promise<Response> {
  const body = await readFile(join(process.cwd(), "public", "seed", name), "utf8");
  // The content itself, not its mtime: a seed regenerated with identical numbers is the same seed,
  // and a checkout gives every file the same fresh mtime anyway.
  const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
  const headers = {
    "content-type": "application/json",
    // Cacheable, but never used without asking first.
    "cache-control": "public, max-age=0, must-revalidate",
    etag,
  };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { headers });
}
