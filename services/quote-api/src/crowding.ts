const AQUA_STANDARD = process.env["ZENTIS_SUBGRAPH_AQUA_STANDARD"] ??
  "https://api.studio.thegraph.com/query/1758742/aqua-standard/v0.2.0";

/**
 * How the whole venue is positioned in one pair, from the standardized Aqua schema.
 *
 * This is the number a pooled AMM cannot produce. A pool's reserves are everyone's deposits with no
 * attribution, so there is no maker base to describe. Aqua's positions are per-maker and every
 * inventory change is emitted, so the venue's aggregate exposure is recoverable from chain data.
 *
 * The subgraph stores raw balances and no prices, deliberately, so the mid is supplied here. That
 * keeps the schema a description of the venue rather than of one team's price model.
 */
export const VENUE_QUERY = `
query Venue($first: Int!) {
  venuePairs(first: $first, orderBy: activePositions, orderDirection: desc) {
    id
    tokenA
    tokenB
    totalCommittedA
    totalCommittedB
    activePositions
    distinctMakers
    distinctApps
    lastUpdatedTimestamp
  }
  _meta {
    block { number hash timestamp }
    hasIndexingErrors
  }
}`;

export interface VenuePair {
  readonly id: string;
  readonly tokenA: string;
  readonly tokenB: string;
  readonly totalCommittedA: string;
  readonly totalCommittedB: string;
  readonly activePositions: number;
  readonly distinctMakers: number;
  readonly distinctApps: number;
  readonly lastUpdatedTimestamp: string;
}

const ONE = 10n ** 18n;
const CROWDING_SCALE = 10_000n;

/**
 * Signed venue lean, in ten-thousandths, positive when the venue is over-weight tokenA.
 *
 *   crowding = (totalA * mid / 1e18 - totalB) / (totalA * mid / 1e18 + totalB)
 *
 * `mid` is raw tokenB per 1e18 raw tokenA, the same scale the references use, so no decimals
 * handling appears here any more than it does on-chain. Returns null for an empty pair, because
 * zero would read as "balanced" when the truth is "nothing is committed".
 */
export function crowdingBps(totalA: bigint, totalB: bigint, mid: bigint): bigint | null {
  if (mid <= 0n) throw new Error("mid must be positive");
  const aInB = (totalA * mid) / ONE;
  const denominator = aInB + totalB;
  if (denominator === 0n) return null;
  return ((aInB - totalB) * CROWDING_SCALE) / denominator;
}

export interface VenueResult {
  readonly pairs: VenuePair[];
  readonly meta: unknown;
  readonly error: string | null;
}

export async function fetchVenue(first: number): Promise<VenueResult> {
  try {
    const response = await fetch(AQUA_STANDARD, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: VENUE_QUERY, variables: { first } })
    });
    if (!response.ok) return { pairs: [], meta: null, error: `subgraph HTTP ${response.status}` };
    const body = (await response.json()) as {
      data?: { venuePairs: VenuePair[]; _meta: unknown };
      errors?: { message: string }[];
    };
    if (body.errors !== undefined && body.errors.length > 0) {
      return { pairs: [], meta: null, error: body.errors[0]!.message };
    }
    return { pairs: body.data?.venuePairs ?? [], meta: body.data?._meta ?? null, error: null };
  } catch (cause) {
    return { pairs: [], meta: null, error: String(cause) };
  }
}
