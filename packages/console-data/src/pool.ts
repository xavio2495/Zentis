import type { PriceSample } from "@zentis/strategy-sdk";
import { type Read, failed, ok, query } from "./graphql.js";
import type { LegConfig } from "./config.js";

/**
 * The reference pool's recent swaps, as the volatility term's input.
 *
 * The slow workflow reads exactly this series to size the spread, so the console reads it the same
 * way — newest first, one pool, a fixed count — and hands it to the same `volatilitySpreadBps`. Any
 * difference between the console's term and the published one is then a difference in *when* the
 * two looked, which is a thing worth showing, and not a difference in how they measured.
 */
export const swapsQuery = (pool: string, first: number): string => `
  pool(id: ${JSON.stringify(pool.toLowerCase())}) { mid liquidity updatedAtTimestamp }
  swaps(where: { pool: ${JSON.stringify(pool.toLowerCase())} }, orderBy: timestamp, orderDirection: desc, first: ${first}) {
    timestamp sqrtPriceX96
  }
`;

export interface PoolSeries {
  readonly mid: bigint;
  readonly liquidity: bigint;
  readonly updatedAtTimestamp: bigint;
  /** newest first, as the workflow reads them */
  readonly samples: PriceSample[];
}

interface RawSeries {
  pool: { mid: string; liquidity: string; updatedAtTimestamp: string } | null;
  swaps: { timestamp: string; sqrtPriceX96: string }[];
}

export function parseSeries(raw: RawSeries, midOf: (sqrtPriceX96: bigint) => bigint): PoolSeries | null {
  if (raw.pool === null) return null;
  return {
    mid: BigInt(raw.pool.mid),
    liquidity: BigInt(raw.pool.liquidity),
    updatedAtTimestamp: BigInt(raw.pool.updatedAtTimestamp),
    samples: raw.swaps.map((s) => ({
      timestamp: BigInt(s.timestamp),
      mid: midOf(BigInt(s.sqrtPriceX96)),
    })),
  };
}

export async function fetchSeries(
  leg: LegConfig,
  midOf: (sqrtPriceX96: bigint) => bigint,
  first = 1000,
): Promise<Read<PoolSeries>> {
  const read = await query<RawSeries>(leg.referencePoolSubgraphUrl, swapsQuery(leg.referencePool, first));
  if (read.value === null) return failed(read.error ?? "the reference-pool subgraph returned nothing");
  const series = parseSeries(read.value, midOf);
  if (series === null) return failed(`${leg.label}'s reference pool is not indexed by its subgraph`);
  return ok(series, read.indexingErrors);
}
