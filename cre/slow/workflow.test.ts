import { describe, expect } from 'bun:test'
import { test } from '@chainlink/cre-sdk/test'

import { sigmaOverHorizonBps, volatilitySpreadBps } from '@zentis/strategy-sdk'

import { bandEdgeFromQuote, marketSamples } from './workflow'
import vectors from './volatility_vectors.json'

describe('bandEdgeFromQuote', () => {
	// 10 USDC (6dp) out, 9.95 USDC back: a 0.5% round trip, so the boundary is 50 bps.
	test('prices the round trip in basis points', () => {
		expect(bandEdgeFromQuote(10_000_000n, 9_950_000n, 6, 6)).toBe(50n)
	})

	test('normalises across differing decimals', () => {
		// same 0.5% shortfall, but the destination leg is 18dp
		expect(bandEdgeFromQuote(10_000_000n, 9_950_000n * 10n ** 12n, 6, 18)).toBe(50n)
	})

	// The reason the slow workflow can be hourly: a venue quote moves continuously, and publishing it
	// raw would burn a seq on noise every hour. Two quotes that differ by less than half a bp must
	// produce the same published number.
	test('rounds to the nearest basis point, so a quiet hour republishes the same value', () => {
		const a = bandEdgeFromQuote(10_000_000n, 9_949_980n, 6, 6)
		const b = bandEdgeFromQuote(10_000_000n, 9_950_020n, 6, 6)
		expect(a).toBe(b)
		expect(a).toBe(50n)
	})

	test('rounds up past the halfway point rather than truncating', () => {
		// 55.5 bps shortfall must land on 56, not 55
		expect(bandEdgeFromQuote(10_000_000n, 9_944_500n, 6, 6)).toBe(56n)
	})

	test('a quote that comes back whole means no boundary at all', () => {
		expect(bandEdgeFromQuote(10_000_000n, 10_000_000n, 6, 6)).toBe(0n)
		expect(bandEdgeFromQuote(10_000_000n, 10_500_000n, 6, 6)).toBe(0n)
	})
})

describe('the volatility series', () => {
	// Recorded from the Uniswap v3 mainnet subgraph through The Graph's decentralised gateway: the
	// same market the mid is read from, which is the point. Measuring the spread on the three
	// testnet reference pools priced risk the position does not carry — those pools are not
	// arbitraged, and Sepolia's term sat near its cap on noise rather than on anything real.
	const swaps = vectors.swaps
	const WINDOW = 604800n
	const HORIZON = 60n

	test('the window is anchored on the newest indexed swap, not on a clock', () => {
		// The enclave has no clock it can trust, and a series that ends where the index ends is the
		// same series on every node. Shifting the whole page back a year must change nothing.
		const shifted = swaps.map((s) => ({ ...s, timestamp: String(BigInt(s.timestamp) - 31_536_000n) }))
		const a = marketSamples(swaps, WINDOW)
		const b = marketSamples(shifted, WINDOW)
		expect(b.map((s) => s.mid)).toEqual(a.map((s) => s.mid))
	})

	test('the samples are handed over oldest-first', () => {
		// The gateway answers newest-first and realisedVarianceRate throws on a descending series.
		const samples = marketSamples(swaps, WINDOW)
		expect(samples.length).toBe(swaps.length)
		for (let i = 1; i < samples.length; i++) {
			expect(samples[i]!.timestamp).toBeGreaterThanOrEqual(samples[i - 1]!.timestamp)
		}
	})

	test('one page of mainnet swaps is the binding limit, not the configured window', () => {
		// On a testnet reference pool a thousand swaps reached back a week. On mainnet USDC/WETH the
		// same page is a couple of hours, so the window never binds and the page length is what sets
		// the sample. Recorded rather than assumed, because it decides what the term measures.
		const samples = marketSamples(swaps, WINDOW)
		const span = samples[samples.length - 1]!.timestamp - samples[0]!.timestamp
		expect(span).toBeLessThan(WINDOW)
		expect(marketSamples(swaps, span / 2n).length).toBeLessThan(samples.length)
	})

	test('the series prices the pair in the same direction as the market mid', () => {
		// token0 is USDC and token1 is WETH on this pool, so sqrtPriceX96 already gives raw tokenB
		// per 1e18 raw tokenA and nothing is inverted. An inverted pair would miss by twelve orders
		// of magnitude, not by the basis points a few minutes of drift costs.
		const spot = BigInt(vectors._spotMidAtRecording)
		for (const sample of marketSamples(swaps, WINDOW)) {
			const off = ((sample.mid > spot ? sample.mid - spot : spot - sample.mid) * 10_000n) / spot
			expect(off).toBeLessThan(200n)
		}
	})

	test('the real market needs no per-leg multiplier override to stay off the cap', () => {
		// Base carried volatilityMultiplierBps 3000 because its testnet reference pool moved in
		// jumps and one sigma pinned the term at the cap. On the real market one sigma over the
		// reference cadence is small, so the global multiplier is the right one everywhere and the
		// override would only floor the term to nothing.
		const samples = marketSamples(swaps, WINDOW)
		expect(sigmaOverHorizonBps(samples, HORIZON)).toBe(2n)
		expect(volatilitySpreadBps(samples, HORIZON, 10_000n, 200n)).toBe(2n)
		expect(volatilitySpreadBps(samples, HORIZON, 3_000n, 200n)).toBe(0n)
	})
})
