import { expect, test } from "bun:test";
import { GET as replay } from "../src/app/api/replay/route";
import { GET as sim } from "../src/app/api/sim/route";

/**
 * What the seed routes promise a cache, which decides what a judge sees.
 *
 * These served `max-age=3600`, and the failure mode is silent and exactly wrong: the moment is
 * re-recorded — say, to replace a carried round with one where the console reproduces the enclave's
 * shift exactly — and a tab opened an hour earlier keeps showing the old one. An ordinary reload
 * does not shift it; only a hard reload does. The one frame this project most needs to be right is
 * the one a stale cache holds back.
 *
 * So the routes revalidate. The body is still cacheable and still cheap — an unchanged seed comes
 * back as a 304 against its ETag — but nothing is served without asking.
 */
const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/replay", { headers });

for (const [name, route] of [["replay", replay], ["sim", sim]] as const) {
  test(`the ${name} route revalidates rather than letting a cache hold an old moment`, async () => {
    const response = await route(request());
    expect(response.status).toBe(200);
    const control = response.headers.get("cache-control") ?? "";
    expect(control).toContain("must-revalidate");
    // No silent window at all: a moment re-recorded a minute ago must reach the next request.
    expect(control).toMatch(/max-age=0|no-cache/);
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]+"$/);
  });

  test(`the ${name} route answers an unchanged seed with a 304, so revalidating stays cheap`, async () => {
    const first = await route(request());
    const etag = first.headers.get("etag")!;
    const again = await route(request({ "if-none-match": etag }));
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
  });

  test(`the ${name} route sends the body when the seed has changed under the reader`, async () => {
    const stale = await route(request({ "if-none-match": '"0000000000000000"' }));
    expect(stale.status).toBe(200);
    expect((await stale.text()).length).toBeGreaterThan(0);
  });
}

test("the replay route serves the committed seed, not a rebuilt one", async () => {
  const body = (await (await replay(request())).json()) as { book: { seq: number }; provenance: { note: string } };
  expect(body.book.seq).toBeGreaterThan(0);
  expect(body.provenance.note).toMatch(/recorded/);
});
