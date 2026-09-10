import { midFromSqrtPriceX96, volatilitySpreadBps } from "@zentis/strategy-sdk";
import type { PriceSample } from "@zentis/strategy-sdk";
import type { BookConfig, LegConfig } from "./config.js";
import type { IndexedPosition } from "./fills.js";
import type { PoolSeries } from "./pool.js";
import type { StoredRef } from "./registry.js";

/**
 * What the taker actually pays over the mid, term by term.
 *
 * `spreadBps` on-chain is already base plus volatility summed by the slow workflow, so the
 * volatility term is recovered by subtracting the base the workflow was configured with rather than
 * by guessing. The staleness widening is not in the struct at all: the instruction derives it from
 * the reference's age at swap time, so it changes between publishes and has to be evaluated at the
 * moment the screen is drawn.
 */
export interface SpreadStack {
  readonly baseBps: number;
  /** the part of the published spread above the configured base */
  readonly volatilityBps: number;
  readonly markoutBps: number;
  /** the age ramp, evaluated now rather than at publish */
  readonly stalenessBps: number;
  readonly totalBps: number;
  readonly referenceAgeSeconds: number;
  /** true once the router refuses to price at all rather than merely widening */
  readonly tooStaleToQuote: boolean;
  /** what the console makes of the pool series now, beside what the workflow published */
  readonly recomputedVolatilityBps: number | null;
}

/**
 * The age ramp as the instruction applies it: a flat rate a minute since the reference's own
 * timestamp, capped. `maxStalenessSeconds` is a refusal and not a cap — past it the leg does not
 * quote wide, it does not quote.
 */
export function stalenessWidening(position: IndexedPosition, ageSeconds: number): number {
  if (ageSeconds <= 0) return 0;
  const widened = Math.floor(ageSeconds / 60) * position.widenBpsPerMinute;
  return Math.min(widened, position.maxWidenBps);
}

/**
 * The volatility term recomputed from the same series the workflow reads, windowed the same way:
 * anchored on the newest swap, oldest first. A gap between this and the published term is the two
 * having looked at different moments, which the screen may say; it is not a disagreement about how
 * volatility is measured, because the measurement is the shared package's.
 */
export function recomputeVolatility(
  series: PoolSeries,
  leg: LegConfig,
  book: BookConfig,
): bigint | null {
  const newest = series.samples[0];
  if (newest === undefined) return null;
  const window = BigInt(book.volatilityWindowSeconds);
  const samples: PriceSample[] = series.samples
    .filter((s) => newest.timestamp - s.timestamp <= window)
    .slice()
    .reverse();
  return volatilitySpreadBps(
    samples,
    BigInt(book.volatilityHorizonSeconds),
    BigInt(leg.volatilityMultiplierBps),
    BigInt(book.volatilityCapBps),
  );
}

export function spreadStack(
  ref: StoredRef,
  position: IndexedPosition,
  book: BookConfig,
  nowSeconds: number,
  recomputedVolatilityBps: bigint | null,
): SpreadStack {
  const age = nowSeconds - Number(ref.updatedAt);
  const staleness = stalenessWidening(position, age);
  const volatility = Math.max(0, ref.spreadBps - book.baseSpreadBps);
  return {
    baseBps: book.baseSpreadBps,
    volatilityBps: volatility,
    markoutBps: ref.markoutBps,
    stalenessBps: staleness,
    totalBps: ref.spreadBps + ref.markoutBps + staleness,
    referenceAgeSeconds: age,
    tooStaleToQuote: age > position.maxStalenessSeconds,
    recomputedVolatilityBps:
      recomputedVolatilityBps === null ? null : Number(recomputedVolatilityBps),
  };
}

/** The pool's own mid, for the `sqrtPriceX96` series the reference-pool subgraph serves. */
export const midOf = midFromSqrtPriceX96;
