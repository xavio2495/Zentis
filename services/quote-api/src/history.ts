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

/** A week, which is the window the volatility term is measured over, and the longest on offer. */
export const HISTORY_HOURS = 168;

/**
 * Below this the hourly series is the wrong instrument: an hour of it is one point, and a chart
 * asked to draw the last hour would show a single step. Short windows read the swaps instead, which
 * on this pool arrive often enough that an hour is a few hundred of them.
 */
const SWAPS_BELOW_HOURS = 12;

export const sourceFor = (hours: number): "swaps" | "hours" => (hours < SWAPS_BELOW_HOURS ? "swaps" : "hours");

/** A window the series can actually answer: at least an hour, at most the week it holds. */
export function clampHours(hours: number): number {
  if (!Number.isFinite(hours)) return HISTORY_HOURS;
  return Math.max(1, Math.min(HISTORY_HOURS, Math.floor(hours)));
}

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

export interface RawSwap {
  timestamp: string;
  sqrtPriceX96: string;
}

/** Swaps into points, oldest first, with any unpriced one left out rather than drawn at zero. */
export function parseSwaps(raw: readonly RawSwap[]): MarkPoint[] {
  return raw
    .map((swap) => ({ t: Number(swap.timestamp), mid: midFromSqrtPrice(swap.sqrtPriceX96) }))
    .filter((point) => point.mid > 0n)
    .sort((a, b) => a.t - b.t);
}

const SWAPS_QUERY = `query Recent($pool: String!, $since: BigInt!) {
  swaps(where: { pool: $pool, timestamp_gte: $since }, orderBy: timestamp, orderDirection: desc, first: 1000) {
    timestamp
    sqrtPriceX96
  }
}`;

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
// One entry per window shape: the hourly week and the short swap window age differently and a
// single slot would have them evicting each other on every alternate request.
const cache = new Map<"swaps" | "hours", Cached>();

export interface MarkHistory {
  readonly points: { t: number; mid: string }[];
  readonly source: string;
  readonly hours: number;
  /** whether the points are hourly closes or individual swaps, which decides how to draw them */
  readonly granularity: "swaps" | "hours";
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
  requestedHours: number = HISTORY_HOURS,
): Promise<MarkHistory> {
  const now = Math.floor(Date.now() / 1000);
  const hours = clampHours(requestedHours);
  const granularity = sourceFor(hours);
  const shape = { source: SOURCE, hours, granularity };
  const render = (points: MarkPoint[], error: string | null): MarkHistory => ({
    ...shape,
    // Both series are cached whole and cut to the window here, so switching from a week to an hour
    // costs nothing and cannot ask the gateway again for something it has already answered.
    points: points.filter((point) => point.t >= now - hours * 3600).map((p) => ({ t: p.t, mid: p.mid.toString() })),
    error,
  });

  if (subgraphUrl === undefined || pool === undefined || apiKey === undefined || apiKey === "") {
    return { ...shape, points: [], error: "no gateway key or pool is configured, so there is no market history" };
  }
  const hit = cache.get(granularity);
  if (hit !== undefined && now - hit.at < CACHE_SECONDS) return render(hit.points, null);

  const query = granularity === "swaps" ? SWAPS_QUERY : QUERY;
  const variables =
    granularity === "swaps"
      ? { pool: pool.toLowerCase(), since: String(now - SWAPS_BELOW_HOURS * 3600) }
      : { pool: pool.toLowerCase(), first: HISTORY_HOURS };

  try {
    const response = await fetch(subgraphUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`the gateway answered ${response.status}`);
    const parsed = (await response.json()) as {
      data?: { poolHourDatas?: RawHour[]; swaps?: RawSwap[] };
      errors?: { message: string }[];
    };
    if (parsed.errors !== undefined && parsed.errors.length > 0) throw new Error(parsed.errors[0]!.message);
    const points =
      granularity === "swaps" ? parseSwaps(parsed.data?.swaps ?? []) : parseHourly(parsed.data?.poolHourDatas ?? []);
    if (points.length === 0) throw new Error(`the gateway returned no priced ${granularity}`);
    cache.set(granularity, { at: now, points });
    return render(points, null);
  } catch (cause) {
    // A stale series beats a blank chart, and says how old it is.
    if (hit !== undefined) return render(hit.points, `${String(cause)}; showing the series read ${now - hit.at}s ago`);
    return { ...shape, points: [], error: String(cause) };
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
