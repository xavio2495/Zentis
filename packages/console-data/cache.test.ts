import { expect, test } from "bun:test";
import { createCache } from "./src/cache.js";

const clock = () => {
  let now = 0;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

test("a source is not refetched before its cadence has elapsed", async () => {
  const time = clock();
  const cache = createCache(time.now);
  let calls = 0;
  const read = () => {
    calls += 1;
    return Promise.resolve({ value: calls, error: null, indexingErrors: false });
  };

  await cache.get("pool", 600_000, read);
  time.advance(60_000);
  await cache.get("pool", 600_000, read);
  // The reference-pool query asks for a thousand swaps over a week. Refetching it every twenty
  // seconds is what exhausted a 3,000-query allowance in an hour.
  expect(calls).toBe(1);

  time.advance(600_000);
  await cache.get("pool", 600_000, read);
  expect(calls).toBe(2);
});

test("a failed read keeps the last good value, and says how old it is", async () => {
  const time = clock();
  const cache = createCache(time.now);
  await cache.get<string>("fills", 0, () =>
    Promise.resolve({ value: "good", error: null, indexingErrors: false }),
  );

  time.advance(45_000);
  const stale = await cache.get<string>("fills", 0, () =>
    Promise.resolve({ value: null, error: "429 Too Many Requests", indexingErrors: false }),
  );

  // A console that blanks when an endpoint rate-limits it is a console that dies mid-demo. It keeps
  // what it had and lets the age say how much to trust it.
  expect(stale.value).toBe("good");
  expect(stale.error).toContain("429");
  expect(stale.ageSeconds).toBe(45);
});

test("a fresh read clears the previous failure", async () => {
  const time = clock();
  const cache = createCache(time.now);
  await cache.get<string>("fills", 0, () => Promise.resolve({ value: "a", error: null, indexingErrors: false }));
  await cache.get<string>("fills", 0, () => Promise.resolve({ value: null, error: "boom", indexingErrors: false }));
  const recovered = await cache.get<string>("fills", 0, () =>
    Promise.resolve({ value: "b", error: null, indexingErrors: false }),
  );
  expect(recovered.value).toBe("b");
  expect(recovered.error).toBeNull();
  expect(recovered.ageSeconds).toBe(0);
});

test("a source that has never answered reports the failure and no value", async () => {
  const cache = createCache(clock().now);
  const never = await cache.get<string>("x", 0, () =>
    Promise.resolve({ value: null, error: "down", indexingErrors: false }),
  );
  expect(never.value).toBeNull();
  expect(never.error).toBe("down");
});

test("overlapping reads of one source are collapsed into one call", async () => {
  const cache = createCache(clock().now);
  let calls = 0;
  const slow = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 30));
    return { value: calls, error: null, indexingErrors: false };
  };
  // Without this a slow endpoint's calls overlap and land out of order, so the screen can go
  // backwards in time.
  const [a, b] = await Promise.all([cache.get("s", 0, slow), cache.get("s", 0, slow)]);
  expect(calls).toBe(1);
  expect(a.value).toBe(b.value);
});

test("a manual refresh can force a source that is inside its cadence", async () => {
  const time = clock();
  const cache = createCache(time.now);
  let calls = 0;
  const read = () => {
    calls += 1;
    return Promise.resolve({ value: calls, error: null, indexingErrors: false });
  };

  await cache.get("fills:1", 60_000, read);
  await cache.get("fills:1", 60_000, read);
  expect(calls).toBe(1);

  // Pressing q, or an action landing, has to be able to ask again immediately — otherwise the
  // cadence that protects the query allowance also hides the write the operator just made.
  cache.invalidate("fills:");
  await cache.get("fills:1", 60_000, read);
  expect(calls).toBe(2);
});

test("invalidating one prefix leaves the expensive sources alone", async () => {
  const time = clock();
  const cache = createCache(time.now);
  let pools = 0;
  const pool = () => {
    pools += 1;
    return Promise.resolve({ value: pools, error: null, indexingErrors: false });
  };
  await cache.get("pool:1", 600_000, pool);
  cache.invalidate("fills:");
  await cache.get("pool:1", 600_000, pool);
  // A week of swaps is not re-read because someone pressed a key.
  expect(pools).toBe(1);
});
