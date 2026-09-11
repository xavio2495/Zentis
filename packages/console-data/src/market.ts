import { QUOTE_API_URL } from "./quotes.js";
import { type Read, failed, json, ok } from "./graphql.js";

/**
 * The one series the whole book prices from.
 *
 * Every leg quotes from a single mid now, and the slow workflow measures the volatility half of its
 * spread on this same mainnet series — the quote service reads it from the workflow's own config
 * rather than restating the pool, so the chart cannot drift from the series the spread came out of.
 * That is why one market chart replaces the three testnet pool charts: those pools were where the
 * legs' trades settled, never what they quoted from, and two of the three have been retired.
 *
 * Hourly points, a week of them. The mainnet pool trades often enough that a thousand swaps cover a
 * few hours, so a per-swap series could not span the window the chart is for.
 */
export interface MarketPoint {
  readonly timestamp: bigint;
  /** raw tokenB per 1e18 raw tokenA, the registry's own units */
  readonly mid: bigint;
}

export interface MarkHistory {
  /** oldest first, so the line reads left to right as time moving forwards */
  readonly points: MarketPoint[];
  /** a sentence for the chart's title: which market this is and who indexed it */
  readonly source: string;
  readonly hours: number;
  /** set when the series is stale; the points are still the last good ones */
  readonly error: string | null;
}

interface RawHistory {
  points: { t: number; mid: string | null }[] | null;
  source?: string;
  hours?: number;
  error?: string | null;
}

/** The payload as a series, or null when there is no series in it to draw. */
export function parseMarkHistory(raw: RawHistory): MarkHistory | null {
  const points = (raw.points ?? [])
    // A point without a mid is not a price of zero; it is a gap, and a zero would draw as a crash.
    .filter((p) => p.mid != null && p.mid !== "0")
    .map((p) => ({ timestamp: BigInt(p.t), mid: BigInt(p.mid!) }))
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  if (points.length === 0) return null;
  return {
    points,
    source: raw.source ?? "the market the book prices from",
    hours: raw.hours ?? 0,
    error: raw.error ?? null,
  };
}

export async function fetchMarkHistory(): Promise<Read<MarkHistory>> {
  const read = await json<RawHistory>(`${QUOTE_API_URL}/mark/history`);
  if (read.value === null) return failed(read.error ?? "the quote service returned no market history");
  const history = parseMarkHistory(read.value);
  if (history === null) return failed(read.value.error ?? "the market series came back empty");
  // A stale series is shown with its reason beside it, like every other source here.
  return history.error === null ? ok(history) : { value: history, error: history.error, indexingErrors: false };
}
