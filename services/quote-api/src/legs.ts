import type { ChainConfig } from "./config.js";

/**
 * One document, sent unchanged to every chain's endpoint.
 *
 * That is the whole point of standardizing the schema: the caller does not branch on which
 * chain it is talking to, and `_meta` travels with the answer so a stale or erroring indexer
 * is visible in the response rather than silently priced in.
 */
export const LEG_QUERY = `
query Leg($positionId: ID!) {
  position(id: $positionId) {
    id
    chainId
    strategyHash
    strategy
    maker
    app
    tokenA
    tokenB
    active
    balanceA
    balanceB
    maxTiltBps
    maxStalenessSeconds
    hasReference
    refMid
    refTiltBps
    refSeq
    refUpdatedAt
    fillCount
  }
  _meta {
    block {
      number
      hash
      timestamp
    }
    hasIndexingErrors
  }
}`;

export interface LegPosition {
  readonly id: `0x${string}`;
  readonly chainId: number;
  readonly strategyHash: `0x${string}`;
  readonly strategy: `0x${string}`;
  readonly maker: `0x${string}`;
  readonly app: `0x${string}`;
  readonly tokenA: `0x${string}`;
  readonly tokenB: `0x${string}`;
  readonly active: boolean;
  readonly balanceA: string;
  readonly balanceB: string;
  readonly maxTiltBps: number;
  readonly maxStalenessSeconds: number;
  readonly hasReference: boolean;
  readonly refMid: string | null;
  readonly refTiltBps: number | null;
  readonly refSeq: number | null;
  readonly refUpdatedAt: string | null;
  readonly fillCount: number;
}

export interface SubgraphMeta {
  readonly block: { readonly number: number; readonly hash: string; readonly timestamp: string };
  readonly hasIndexingErrors: boolean;
}

export interface LegResult {
  readonly chain: ChainConfig;
  readonly position: LegPosition | null;
  readonly meta: SubgraphMeta | null;
  readonly error: string | null;
}

/**
 * Every /quote costs one Studio query per leg, and Studio's allowance (~3,000 per three hours at
 * the time of writing) is shared with the workflows and the console. A leg's indexed state does
 * not change between two quotes a few seconds apart, so a read is reused for a short window, and
 * when Studio refuses, the last good read is served with a note rather than a blank leg. The
 * window is deliberately short: this is the surface a taker acts on, and a stale balance is a
 * mispriced quote, so ZENTIS_LEG_CACHE_SECONDS trades allowance for freshness and nothing else.
 */
const CACHE_SECONDS = Number(process.env["ZENTIS_LEG_CACHE_SECONDS"] ?? "60");
interface Cached { readonly result: LegResult; readonly at: number }
const fresh = new Map<string, Cached>();
const lastGood = new Map<string, Cached>();
const keyOf = (chain: ChainConfig, positionId: string) => `${chain.chainId}:${positionId.toLowerCase()}`;

/** Forget cached reads; with `keepLastGood` only the freshness window is cleared. */
export function clearLegCache(options: { keepLastGood?: boolean } = {}): void {
  fresh.clear();
  if (!options.keepLastGood) lastGood.clear();
}

export async function fetchLeg(
  chain: ChainConfig,
  positionId: string,
  signal?: AbortSignal
): Promise<LegResult> {
  const key = keyOf(chain, positionId);
  const now = Date.now();
  const hit = fresh.get(key);
  if (hit !== undefined && now - hit.at < CACHE_SECONDS * 1000) return hit.result;

  const result = await fetchLegUncached(chain, positionId, signal);
  if (result.error === null) {
    fresh.set(key, { result, at: now });
    lastGood.set(key, { result, at: now });
    return result;
  }
  const good = lastGood.get(key);
  if (good === undefined) return result;
  const age = Math.round((now - good.at) / 1000);
  return { ...good.result, error: `${result.error}; showing what was read ${age}s ago` };
}

async function fetchLegUncached(
  chain: ChainConfig,
  positionId: string,
  signal?: AbortSignal
): Promise<LegResult> {
  try {
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: LEG_QUERY, variables: { positionId } })
    };
    if (signal !== undefined) init.signal = signal;

    const response = await fetch(chain.subgraphUrl, init);
    if (!response.ok) {
      return { chain, position: null, meta: null, error: `subgraph HTTP ${response.status}` };
    }
    const body = (await response.json()) as {
      data?: { position: LegPosition | null; _meta: SubgraphMeta | null };
      errors?: { message: string }[];
    };
    if (body.errors !== undefined && body.errors.length > 0) {
      return { chain, position: null, meta: null, error: body.errors[0]!.message };
    }
    return {
      chain,
      position: body.data?.position ?? null,
      meta: body.data?._meta ?? null,
      error: null
    };
  } catch (cause) {
    return { chain, position: null, meta: null, error: String(cause) };
  }
}
