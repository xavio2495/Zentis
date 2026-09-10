import { BPS, ONE } from './policy'

/**
 * Realised volatility over the reference cadence, from an irregularly sampled price series.
 *
 * The spread has to cover the move the price makes between two references, because that is how far
 * a quote can be stale before it is repriced. So the horizon is the cadence, and the term is the
 * standard deviation of the mid over that horizon, in basis points.
 *
 * Samples arrive whenever the reference pool trades, not on a clock. The estimator that handles
 * that is the sum of squared returns over the total elapsed time, the variance rate per second
 * under Brownian scaling; times the horizon, rooted, is sigma over the horizon. Two swaps in the
 * same second are one observation and the later one stands. Rounded to the nearest basis point at
 * the very end, so a quiet hour republishes the same value. Mirrors `reference_model.volatility`.
 */

export type PriceSample = { timestamp: bigint; mid: bigint }

/** Floor of the square root, by Newton's method, matching the model's integer routine exactly. */
export const isqrt = (n: bigint): bigint => {
	if (n < 0n) throw new Error('no real root')
	if (n < 2n) return n
	let x = n
	let y = (x + 1n) / 2n
	while (y < x) {
		x = y
		y = (x + n / x) / 2n
	}
	return x
}

/** `[sum of squared 1e18-scaled returns, elapsed seconds]` over an ascending series. */
export const realisedVarianceRate = (samples: PriceSample[]): [bigint, bigint] => {
	const kept: PriceSample[] = []
	for (const s of samples) {
		if (s.mid <= 0n) throw new Error('mid must be positive')
		const last = kept[kept.length - 1]
		if (last && s.timestamp < last.timestamp) throw new Error('samples must be in ascending time order')
		if (last && s.timestamp === last.timestamp) kept[kept.length - 1] = s
		else kept.push(s)
	}
	if (kept.length < 2) return [0n, 0n]

	let sumSq = 0n
	for (let i = 1; i < kept.length; i++) {
		const prev = (kept[i - 1] as PriceSample).mid
		const cur = (kept[i] as PriceSample).mid
		const r = cur >= prev ? ((cur - prev) * ONE) / prev : -(((prev - cur) * ONE) / prev)
		sumSq += r * r
	}
	return [sumSq, (kept[kept.length - 1] as PriceSample).timestamp - (kept[0] as PriceSample).timestamp]
}

export const sigmaOverHorizonBps = (samples: PriceSample[], horizonSeconds: bigint): bigint => {
	const [sumSq, elapsed] = realisedVarianceRate(samples)
	if (elapsed === 0n) return 0n
	const sigma = isqrt((horizonSeconds * sumSq) / elapsed) // 1e18-scaled
	return (sigma * BPS + ONE / 2n) / ONE // nearest basis point
}

/**
 * The term the spread carries: `multiplier * sigma_H`, floored at zero, capped. Capped because the
 * spread instruction reverts the whole swap when its terms sum past the full basis, so an unbounded
 * term would not widen a leg, it would brick it.
 */
export const volatilitySpreadBps = (
	samples: PriceSample[],
	horizonSeconds: bigint,
	multiplierBps: bigint,
	capBps: bigint,
): bigint => {
	if (capBps < 0n || multiplierBps < 0n) throw new Error('neither the cap nor the multiplier may be negative')
	const term = (multiplierBps * sigmaOverHorizonBps(samples, horizonSeconds)) / BPS
	return term > capBps ? capBps : term
}
