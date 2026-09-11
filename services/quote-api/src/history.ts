/**
 * The market series the book is priced and measured against, for one chart.
 *
 * The legs stopped quoting from their own testnet pools on 2026-09-11: there is one mid now, read
 * from the real mainnet WETH/USDC market, and the volatility half of the spread is measured on the
 * Uniswap v3 mainnet pool through The Graph's decentralised gateway. A console drawing three
 * testnet pool lines would therefore be drawing three prices nothing on screen quotes from. This
 * serves the one series that is actually behind both numbers, so the chart, the mid and the spread
 * all come from the same place.
 *
 * Hourly rather than per-swap: the mainnet pool trades often enough that a thousand swaps cover a
 * few hours, and the window the spread is measured over is a week. `poolHourDatas` gives the week
 * in 168 points, and its `sqrtPrice` is converted with the enclave's own arithmetic so the chart is
 * in the registry's units and never passes through a float.
 */
import slowConfig from "../../../cre/slow/config.staging.json" with { type: "json" };

/** A week, which is the window the volatility term is measured over. */
export const HISTORY_HOURS = 168;

const CACHE_SECONDS = Number(process.env["ZENTIS_HISTORY_CACHE_SECONDS"] ?? "600");

export interface MarkPoint {
  /** seconds since the epoch, at the start of the hour */
  readonly t: number;
  /** raw tokenB per 1e18 raw tokenA, the same units as `/mark` and the registry */
  readonly mid: bigint;
}

export interface RawHour {
  periodStartUnix: number;
  sqrtPrice: string;
}

/** mid = (sqrtPrice^2 * 1e18) >> 192, the conversion the workflows use. */
export function midFromSqrtPrice(sqrtPrice: string): bigint {
  const sqrt = BigInt(sqrtPrice);
  return (sqrt * sqrt * 10n ** 18n) >> 192n;
}

/** Oldest first, with any hour that carries no price left out rather than drawn at zero. */
export function parseHourly(raw: readonly RawHour[]): MarkPoint[] {
  return raw
    .map((hour) => ({ t: Number(hour.periodStartUnix), mid: midFromSqrtPrice(hour.sqrtPrice) }))
    .filter((point) => point.mid > 0n)
    .sort((a, b) => a.t - b.t);
}

const QUERY = `query History($pool: String!, $first: Int!) {
  poolHourDatas(where: { pool: $pool }, orderBy: periodStartUnix, orderDirection: desc, first: $first) {
    periodStartUnix
    sqrtPrice
  }
}`;

interface Cached {
  at: number;
  points: MarkPoint[];
}
let cached: Cached | null = null;

export interface MarkHistory {
  readonly points: { t: number; mid: string }[];
  readonly source: string;
  readonly hours: number;
  readonly error: string | null;
}

const SOURCE = "Uniswap v3 mainnet USDC/WETH, via The Graph";

/**
 * The series, cached for ten minutes. The gateway call is billed against the maker's own key and an
 * hourly series does not move faster than that, so a chart repainting every twenty seconds has no
 * business asking again.
 */
export async function fetchMarkHistory(
  subgraphUrl: string | undefined,
  pool: string | undefined,
  apiKey: string | undefined,
): Promise<MarkHistory> {
  const now = Math.floor(Date.now() / 1000);
  const empty = { points: [], source: SOURCE, hours: HISTORY_HOURS };
  if (subgraphUrl === undefined || pool === undefined || apiKey === undefined || apiKey === "") {
    return { ...empty, error: "no gateway key or pool is configured, so there is no market history" };
  }
  if (cached !== null && now - cached.at < CACHE_SECONDS) {
    return { points: cached.points.map((p) => ({ t: p.t, mid: p.mid.toString() })), source: SOURCE, hours: HISTORY_HOURS, error: null };
  }
  try {
    const response = await fetch(subgraphUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { pool: pool.toLowerCase(), first: HISTORY_HOURS } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`the gateway answered ${response.status}`);
    const body = (await response.json()) as { data?: { poolHourDatas: RawHour[] }; errors?: { message: string }[] };
    if (body.errors !== undefined && body.errors.length > 0) throw new Error(body.errors[0]!.message);
    const points = parseHourly(body.data?.poolHourDatas ?? []);
    if (points.length === 0) throw new Error("the gateway returned no priced hours");
    cached = { at: now, points };
    return { points: points.map((p) => ({ t: p.t, mid: p.mid.toString() })), source: SOURCE, hours: HISTORY_HOURS, error: null };
  } catch (cause) {
    // A stale series beats a blank chart, and says how old it is.
    if (cached !== null) {
      return {
        points: cached.points.map((p) => ({ t: p.t, mid: p.mid.toString() })),
        source: SOURCE,
        hours: HISTORY_HOURS,
        error: `${String(cause)}; showing the series read ${now - cached.at}s ago`,
      };
    }
    return { ...empty, error: String(cause) };
  }
}

/**
 * The subgraph and pool are read from the slow workflow's own config rather than restated, so the
 * chart cannot drift from the series the spread is measured on. The key is the service's own.
 */
export const historyConfig = () => ({
  subgraphUrl: process.env["ZENTIS_VOLATILITY_SUBGRAPH"] ?? slowConfig.volatility?.subgraphUrl,
  pool: process.env["ZENTIS_VOLATILITY_POOL"] ?? slowConfig.volatility?.pool,
  apiKey: process.env["GRAPH_API_KEY"],
});
