import { describe, expect, test } from 'bun:test'
import { recoverRoom } from './src/index'

/**
 * The published boundary is the shift plus the room the slow workflow allocated, clamped to the
 * maker's signed cap. Reading the room back as boundary minus shift is exact below the cap and
 * meaningless at it: a boundary sitting on the cap could be any shift plus any room. Reading it as
 * zero there would refuse a concession the enclave never refused.
 */
describe('recovering the concession room from a published boundary', () => {
	test('no boundary published means no budget known', () => {
		expect(recoverRoom(0n, -120n, 500n)).toBeNull()
	})
	test('below the cap the room is exact', () => {
		expect(recoverRoom(117n, 56n, 500n)).toBe(61n)
		expect(recoverRoom(150n, 89n, 500n)).toBe(61n)
	})
	test('a boundary below the shift, which a stale write can leave, is zero room, not negative', () => {
		expect(recoverRoom(57n, -198n, 500n)).toBe(0n)
	})
	test('a boundary on the cap is unrecoverable, whether or not the shift is', () => {
		expect(recoverRoom(500n, -500n, 500n)).toBeNull()
		expect(recoverRoom(500n, 480n, 500n)).toBeNull()
	})
})
