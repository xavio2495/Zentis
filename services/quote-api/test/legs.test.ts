import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearLegCache, fetchLeg } from "../src/legs.js";
import type { ChainConfig } from "../src/config.js";

/**
 * Every /quote costs one Studio query per leg, and Studio's allowance is about a thousand an hour
 * shared with the workflows and the console. A leg's indexed state does not change between two
 * quotes a few seconds apart, so it is cached briefly, and when Studio refuses the last good read
 * is served with a note rather than a blank leg.
 */
const chain: ChainConfig = { chainId: 11155111, name: "sepolia", subgraphUrl: "https://studio.test/leg", rpcUrl: "http://rpc" };
const POSITION = "0x01";
const ok = { data: { position: { id: POSITION, chainId: 11155111, active: true }, _meta: { block: { number: 1, hash: "0x", timestamp: "1" }, hasIndexingErrors: false } } };

let calls: number;
let respond: () => Response;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = 0;
  respond = () => new Response(JSON.stringify(ok), { status: 200, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async () => { calls += 1; return respond(); }) as unknown as typeof fetch;
  clearLegCache();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("leg reads are cached and survive a refusal", () => {
  test("two reads inside the window cost one query", async () => {
    await fetchLeg(chain, POSITION);
    await fetchLeg(chain, POSITION);
    expect(calls).toBe(1);
  });

  test("a different leg or position is its own entry", async () => {
    await fetchLeg(chain, POSITION);
    await fetchLeg({ ...chain, chainId: 84532 }, POSITION);
    await fetchLeg(chain, "0x02");
    expect(calls).toBe(3);
  });

  test("a refusal after a good read serves the last good read, and says so", async () => {
    const first = await fetchLeg(chain, POSITION);
    clearLegCache({ keepLastGood: true });
    respond = () => new Response("Too many requests", { status: 429, headers: { "content-type": "text/html" } });
    const second = await fetchLeg(chain, POSITION);
    expect(second.position).toEqual(first.position);
    expect(second.error).toMatch(/HTTP 429/);
    expect(second.error).toMatch(/showing what was read/);
  });

  test("a refusal with nothing good behind it is reported as before", async () => {
    respond = () => new Response("Too many requests", { status: 429 });
    const result = await fetchLeg(chain, POSITION);
    expect(result.position).toBeNull();
    expect(result.error).toBe("subgraph HTTP 429");
  });
});
