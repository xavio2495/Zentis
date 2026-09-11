import { expect, test } from "bun:test";
import { parseQuota } from "./src/graphql.js";
import { providersOf } from "./src/providers.js";
import type { Snapshot } from "./src/snapshot.js";

/**
 * What an endpoint says about itself in its headers.
 *
 * Studio meters each deployment over a window of hours, and the two facts that matter — how many
 * queries are left and when the window resets — are in the headers of every answer, not only the
 * refusals. Reading them only when a request failed meant the console could say "out of allowance"
 * but never "getting close", which is the point at which someone could still do something about it.
 */
const headersOf = (entries: Record<string, string>) => new Headers(entries);

test("the allowance is read from any answer, not only from a refusal", () => {
  const quota = parseQuota(headersOf({ "x-ratelimit-remaining": "2865", "x-ratelimit-reset": "1789200000" }))!;
  expect(quota.remaining).toBe(2865);
  expect(quota.resetsAtSeconds).toBe(1789200000);
});

test("an endpoint that says nothing about its allowance is not reported as having none", () => {
  expect(parseQuota(headersOf({}))).toBeNull();
  expect(parseQuota(headersOf({ "x-ratelimit-remaining": "not a number" }))).toBeNull();
});

const leg = (fills: string | null, quota: unknown = null) =>
  ({
    config: { chainId: 1, name: "sepolia", label: "Sepolia", tokenA: { symbol: "USDC", decimals: 6 }, tokenB: { symbol: "WETH", decimals: 18 } },
    sources: { fills, registry: null, pool: null, fillsQuota: quota },
    ref: { seq: 7, updatedAt: 1000n },
    spread: null,
    position: null,
    mark: null,
  }) as never;

const snapshotWith = (legs: unknown[], caveats: string[] = [], extra: Record<string, unknown> = {}): Snapshot =>
  ({ legs, caveats, takenAtSeconds: 2000, seq: 7, market: null, wallet: null, ...extra } as never);

test("a provider is up, stale or down — three states, because last-good is neither of the others", () => {
  const up = providersOf(snapshotWith([leg(null)])).find((p) => p.kind === "fills")!;
  expect(up.state).toBe("up");
  const down = providersOf(snapshotWith([leg("subgraph HTTP 429, resets 21:52Z")])).find((p) => p.kind === "fills")!;
  expect(down.state).toBe("down");
  expect(down.resetsAt).toBe("21:52Z");
  // A service answering from its last good value is not up and is not down.
  const stale = providersOf(
    snapshotWith([leg(null)], ["the market series: the gateway returned 502"], { market: { points: [{}], source: "x", hours: 1, granularity: "hours", error: "the gateway returned 502" } }),
  ).find((p) => p.kind === "market")!;
  expect(stale.state).toBe("stale");
});

test("a provider carries what the status page needs: its cadence and its allowance", () => {
  const providers = providersOf(snapshotWith([leg(null, { remaining: 2865, resetsAtSeconds: 1789200000 })]));
  const fills = providers.find((p) => p.kind === "fills")!;
  expect(fills.cadenceSeconds).toBeGreaterThan(0);
  expect(fills.quota?.remaining).toBe(2865);
  // The RPC has a cadence too, and no allowance anyone publishes.
  const rpc = providers.find((p) => p.kind === "rpc")!;
  expect(rpc.cadenceSeconds).toBeGreaterThanOrEqual(0);
  expect(rpc.quota).toBeNull();
});
