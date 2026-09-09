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

export async function fetchLeg(
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
