import { describe, expect } from 'bun:test'
import { test } from '@chainlink/cre-sdk/test'

import { bandEdgeFromQuote } from './workflow'

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
