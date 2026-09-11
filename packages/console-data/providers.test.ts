import { expect, test } from "bun:test";
import { providersOf } from "./src/providers.js";
import type { Snapshot } from "./src/snapshot.js";

/**
 * One status line per thing the console depends on.
 *
 * The console reads eleven endpoints across three chains, and until now a failure in any of them
 * arrived as a sentence somewhere on the screen — in a card, in the feed, in the status bar's
 * caveats — so nobody could tell at a glance which were answering. This is the list.
 */
const leg = (chainId: number, name: string, fills: string | null, registry: string | null) =>
  ({
    config: { chainId, name, label: name, tokenA: { symbol: "USDC", decimals: 6 }, tokenB: { symbol: "WETH", decimals: 18 } },
    sources: { fills, registry, pool: null },
    ref: registry === null ? { seq: 7, updatedAt: 1000n } : null,
    spread: null,
    position: null,
    mark: null,
  }) as never;

const snapshotWith = (legs: unknown[], caveats: string[] = []): Snapshot =>
  ({ legs, caveats, takenAtSeconds: 2000, seq: 7, market: null, wallet: null } as never);

test("every chain contributes its own two endpoints, named by the chain", () => {
  const providers = providersOf(
    snapshotWith([leg(1, "sepolia", null, null), leg(2, "base-sepolia", null, null)]),
  );
  for (const name of ["sepolia", "base-sepolia"]) {
    expect(providers.filter((p) => p.name.includes(name) && p.kind === "rpc")).toHaveLength(1);
    expect(providers.filter((p) => p.name.includes(name) && p.kind === "fills")).toHaveLength(1);
  }
});

test("a source that refused is down, with the short reason rather than the paragraph", () => {
  const providers = providersOf(
    snapshotWith([leg(1, "sepolia", "subgraph HTTP 429, resets 21:52Z", null)]),
  );
  const fills = providers.find((p) => p.kind === "fills")!;
  expect(fills.ok).toBe(false);
  expect(fills.reason).toContain("429");
  // Short enough to sit on one line beside its own name at eighty columns.
  expect(fills.reason!.length).toBeLessThanOrEqual(40);
});

test("the services the whole book depends on are listed once, not per leg", () => {
  const providers = providersOf(snapshotWith([leg(1, "sepolia", null, null)]));
  for (const kind of ["quotes", "mark", "market"] as const) {
    expect(providers.filter((p) => p.kind === kind)).toHaveLength(1);
  }
});

test("a book-wide service reads its state from the snapshot's own caveat", () => {
  const providers = providersOf(
    snapshotWith([leg(1, "sepolia", null, null)], ["the market series: the gateway returned 502"]),
  );
  const market = providers.find((p) => p.kind === "market")!;
  expect(market.ok).toBe(false);
  expect(market.reason).toContain("502");
});

test("the registries' freshness is a provider too, since a stale reference is a source going quiet", () => {
  const providers = providersOf(snapshotWith([leg(1, "sepolia", null, null)]));
  const registries = providers.find((p) => p.kind === "reference")!;
  expect(registries).toBeDefined();
  expect(registries.detail).toMatch(/\d/);
});
