import { describe, expect } from 'bun:test'
import { test } from '@chainlink/cre-sdk/test'
import type { TeeRuntime } from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters } from 'viem'

import { onCronTrigger, restrictions, type Config } from './workflow'
import { antiSymmetric, legWeight, midFromSqrtPriceX96 } from './policy'

const KAPPA = '10000'
const KAPPA_BOOK = '5000'

const config: Config = {
	schedule: '*/10 * * * * *',
	positionId: `0x${'00'.repeat(31)}01`,
	kappaSecretId: 'KAPPA_BPS',
	kappaBookSecretId: 'KAPPA_BOOK_BPS',
	spreadBps: 10,
	markoutBps: 0,
	maxTiltBps: 500,
	maxExtrapBps: 100,
	maker: '0x4887B4695dEe830A341304bFEb14538E2442DD55',
	legA: {
		chainSelector: '10344971235874465080',
		pool: '0x46880b404CD35c165EDdefF7421019F8dD25F4Ad',
		aqua: '0xb8790fd154f3c36c4d83e6e59f0550bae7cceff9',
		app: '0xdd9752b377870bd9e41cd041f4a0e90770d0fb41',
		strategyHash: `0x${'11'.repeat(32)}`,
		tokenA: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
		tokenB: '0x4200000000000000000000000000000000000006',
		registry: '0x2FE4cCe316287505ce114101b9d58c1f56d8E910',
	},
	legB: {
		chainSelector: '3478487238524512106',
		pool: '0x66EEAB70aC52459Dd74C6AD50D578Ef76a441bbf',
		aqua: '0x8F4f807C72a2BfAB4024e783f68Fc714d0Ce2bbe',
		app: '0xfc603336a7b797f2d7eba03ed69734fad9ea521b',
		strategyHash: `0x${'22'.repeat(32)}`,
		tokenA: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
		tokenB: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
		registry: '0xB7e37E396bBB785c346D1909231a9B3D2707Cd32',
	},
}

const bytes = (hex: string) => {
	const clean = hex.replace(/^0x/, '')
	const out = new Uint8Array(clean.length / 2)
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
	return out
}

// `.result()` hands back the protobuf MESSAGE, not its JSON form, so absVal is raw bytes here —
// base64 is only the wire encoding.
const protoBigInt = (n: bigint) => {
	const hex = n.toString(16)
	return { absVal: bytes(hex.length % 2 ? `0${hex}` : hex), sign: 1n }
}

const slot0Data = (sqrtPriceX96: bigint) =>
	bytes(
		encodeAbiParameters(parseAbiParameters('uint160, int24, uint16, uint16, uint16, uint8, bool'), [
			sqrtPriceX96,
			0,
			0,
			1,
			1,
			0,
			true,
		]),
	)

const balancesData = (a: bigint, b: bigint) =>
	bytes(encodeAbiParameters(parseAbiParameters('uint256, uint256'), [a, b]))

/** What the registry already holds for this leg. A zero mid means nothing has been published. */
type Stored = { mid: bigint; spreadBps: number; markoutBps: number; bandEdgeBps: number }
const NOTHING_STORED: Stored = { mid: 0n, spreadBps: 0, markoutBps: 0, bandEdgeBps: 0 }

const storedData = (stored: Stored) =>
	bytes(
		encodeAbiParameters(
			parseAbiParameters(
				'(uint128 mid, uint16 spreadBps, int16 tiltBps, uint40 updatedAt, uint32 seq, uint128 refBalanceA, int64 dTiltPerA, uint32 maxExtrapBps, uint16 markoutBps, uint16 bandEdgeBps)',
			),
			[
				{
					mid: stored.mid,
					spreadBps: stored.spreadBps,
					tiltBps: 0,
					updatedAt: stored.mid === 0n ? 0 : 1788891000,
					seq: stored.mid === 0n ? 0 : 1788891000,
					refBalanceA: 0n,
					dTiltPerA: 0n,
					maxExtrapBps: 0,
					markoutBps: stored.markoutBps,
					bandEdgeBps: stored.bandEdgeBps,
				},
			],
		),
	)

/**
 * A chain that never changes: both legs' finalized block, pool price and Aqua balances are fixed.
 * Every determinism claim in this file rests on the handler being a pure function of these.
 */
type ChainState = {
	blockA: bigint
	tsA: bigint
	sqrtA: bigint
	balA: [bigint, bigint]
	blockB: bigint
	tsB: bigint
	sqrtB: bigint
	balB: [bigint, bigint]
	storedA: Stored
	storedB: Stored
}

const CHAIN: ChainState = {
	blockA: 46561623n,
	tsA: 1788891534n,
	sqrtA: 1315805077060885543498123125042033n,
	balA: [15_000_000n, 4137282795001288n],
	blockB: 306809662n,
	tsB: 1788891600n,
	sqrtB: 1782527366555253651198357277536396n,
	balB: [15_000_000n, 7592844468186735n],
	storedA: NOTHING_STORED,
	storedB: NOTHING_STORED,
}

const makeRuntime = (chain: ChainState = CHAIN) => {
	const logs: string[] = []
	const reports: string[] = []
	const calls: string[] = []

	// header, slot0, safeBalances, refOf — per leg, in the order observeLeg issues them.
	const queue: Array<() => unknown> = [
		() => ({ header: { blockNumber: protoBigInt(chain.blockA), timestamp: chain.tsA } }),
		() => ({ data: slot0Data(chain.sqrtA) }),
		() => ({ data: balancesData(chain.balA[0], chain.balA[1]) }),
		() => ({ data: storedData(chain.storedA) }),
		() => ({ header: { blockNumber: protoBigInt(chain.blockB), timestamp: chain.tsB } }),
		() => ({ data: slot0Data(chain.sqrtB) }),
		() => ({ data: balancesData(chain.balB[0], chain.balB[1]) }),
		() => ({ data: storedData(chain.storedB) }),
	]
	let i = 0

	const don = {
		config,
		callCapability: ({ method }: { method: string }) => {
			calls.push(method)
			if (method === 'WriteReport') return { result: () => ({}) }
			const next = queue[i++]
			if (!next) throw new Error(`unexpected extra capability call: ${method}`)
			return { result: () => next() }
		},
		report: (input: { encodedPayload?: string }) => {
			reports.push(input.encodedPayload ?? '')
			// writeReport unwraps the Report, so the double has to carry that method.
			return { result: () => ({ x_generatedCodeOnly_unwrap: () => ({}) }) }
		},
		log: (m: string) => logs.push(m),
	}

	const runtime = {
		config,
		getSecret: ({ id }: { id: string }) => ({
			result: () => ({ value: id === 'KAPPA_BOOK_BPS' ? KAPPA_BOOK : KAPPA }),
		}),
		log: (m: string) => logs.push(m),
		usingTheDons: () => don,
	}

	return { runtime: runtime as unknown as TeeRuntime<Config>, logs, reports, calls }
}

describe('fast workflow', () => {
	// 5.2 — the load-bearing claim. With no attestation checking us in simulation, "same pinned
	// block in, identical bytes out" is the only evidence this workflow is enclave-shaped.
	test('two runs over the same pinned block produce byte-identical reports', () => {
		const first = makeRuntime()
		const second = makeRuntime()

		const a = onCronTrigger(first.runtime)
		const b = onCronTrigger(second.runtime)

		expect(first.reports).toHaveLength(2)
		expect(second.reports).toEqual(first.reports)
		expect(b).toEqual(a)
	})

	test('a different pinned block produces a different report', () => {
		const base = makeRuntime()
		onCronTrigger(base.runtime)

		// Same everything except one leg's inventory: the reports must diverge, or the test above
		// would pass for a handler that ignores its inputs entirely.
		const moved = makeRuntime({ ...CHAIN, balA: [20_000_000n, 4137282795001288n] })
		onCronTrigger(moved.runtime)

		expect(moved.reports).not.toEqual(base.reports)
	})

	// 5.3 — zero enclave logging, enforced rather than asserted in a comment.
	test('nothing is logged from inside the enclave', () => {
		const { runtime, logs } = makeRuntime()
		onCronTrigger(runtime)
		expect(logs).toEqual([])
	})

	test('a leg holding excess tokenA is repriced dear, and the rest of the book sheds it', () => {
		// Leg A is deliberately over-weight tokenA. On a constant-product curve that means its own
		// price already sits below the mid, so the anchor makes tokenA dear there: a negative tilt.
		// Leg B is even, but the book as a whole holds excess tokenA, so the book skew has it
		// discount tokenA a little: a small positive tilt.
		const { runtime, reports } = makeRuntime({
			...CHAIN,
			balA: [25_000_000n, 4137282795001288n],
		})
		onCronTrigger(runtime)

		const refOf = (payload: string) => decodeRef(payload)[1]
		const refA = refOf(reports[0]!)
		const refB = refOf(reports[1]!)
		expect(refA.tiltBps).toBeLessThan(0)
		expect(refB.tiltBps).toBeGreaterThan(0)
		expect(-refA.tiltBps).toBeGreaterThan(refB.tiltBps)
		// Accumulating tokenA on leg A must move its tilt further down between references.
		expect(refA.dTiltPerA).toBeLessThan(0n)
	})

	test('the terms the slow workflow publishes survive the next fast write', () => {
		// The slow workflow measures the spread, the markout and the boundary and writes them into
		// the same slot. If this workflow rebuilt the slot from its config every minute, an hour's
		// measurement would live for at most sixty seconds.
		const { runtime, reports } = makeRuntime({
			...CHAIN,
			storedA: { mid: 1n, spreadBps: 22, markoutBps: 37, bandEdgeBps: 54 },
		})
		onCronTrigger(runtime)
		const [, refA] = decodeRef(reports[0]!)
		const [, refB] = decodeRef(reports[1]!)
		expect(refA.spreadBps).toBe(22)
		expect(refA.markoutBps).toBe(37)
		expect(refA.bandEdgeBps).toBe(54)
		// Nothing published on leg B yet, so it bootstraps from the config.
		expect(refB.spreadBps).toBe(config.spreadBps)
		expect(refB.markoutBps).toBe(0)
		expect(refB.bandEdgeBps).toBe(0)
	})

	test('the published seq and updatedAt are shared by both legs', () => {
		const { runtime, reports } = makeRuntime()
		onCronTrigger(runtime)
		const [, refA] = decodeRef(reports[0]!)
		const [, refB] = decodeRef(reports[1]!)
		expect(refA.seq).toBe(refB.seq)
		expect(refA.updatedAt).toBe(refB.updatedAt)
		// never fresher than the laggier leg
		expect(BigInt(refA.updatedAt)).toBe(CHAIN.tsA < CHAIN.tsB ? CHAIN.tsA : CHAIN.tsB)
	})

	test('the capability budget covers the calls actually made, with headroom', () => {
		const { runtime, calls } = makeRuntime()
		onCronTrigger(runtime)

		const made = (m: string) => calls.filter((c) => c === m).length
		const budget = restrictions(config).capabilities.restrictions
		const allowed = (m: string) =>
			budget
				.filter((r) => r.method?.method === m)
				.reduce((sum, r) => sum + (r.method?.maxCalls ?? 0), 0)

		for (const method of ['HeaderByNumber', 'CallContract', 'WriteReport']) {
			expect(made(method)).toBeGreaterThan(0)
			// Sized for the worst execution, not the average: a budget equal to the observed count is
			// the audit-firewall template's bug, where one retry takes the workflow down.
			expect(allowed(method)).toBeGreaterThanOrEqual(2 * made(method))
		}
	})
})

describe('policy', () => {
	// Byte-for-byte against packages/reference-model, on the numbers a live run actually produced.
	// Three implementations of this arithmetic exist — Solidity, Python, TypeScript — and a
	// disagreement between any two of them is a mispriced quote.
	test('matches the Python reference model exactly', () => {
		const base = legWeight({
			balanceA: 11_000_000n,
			balanceB: 2508444095896729n,
			mid: 275818853000085890554200491n,
		})
		const arb = legWeight({
			balanceA: 10_000_000n,
			balanceB: 5061896312124490n,
			mid: 506189631212449007683687217n,
		})
		const [p0, p1] = antiSymmetric(base, arb, 500n, 500n)

		expect(base.weightA).toBe(547412545122967270n)
		expect(arb.weightA).toBe(500000025000001250n)
		expect(p0.tiltBps).toBe(11n)
		expect(p1.tiltBps).toBe(-11n)
		expect(p0.dTiltPerA).toBe(5630728421930n)
		expect(p1.dTiltPerA).toBe(6249999999999n)
	})

	test('two legs saturate at half the gain, so a gain equal to the cap never clamps', () => {
		const allA = legWeight({ balanceA: 1_000_000n, balanceB: 0n, mid: 10n ** 18n })
		const allB = legWeight({ balanceA: 0n, balanceB: 1_000_000n, mid: 10n ** 18n })
		const [p0, p1] = antiSymmetric(allA, allB, 500n, 500n)
		expect(p0.tiltBps).toBe(250n)
		expect(p1.tiltBps).toBe(-250n)
	})

	test('the tilt is clamped to maxTiltBps', () => {
		const allA = legWeight({ balanceA: 1_000_000n, balanceB: 1n, mid: 10n ** 30n })
		const allB = legWeight({ balanceA: 1n, balanceB: 1_000_000n, mid: 10n ** 18n })
		const [p0, p1] = antiSymmetric(allA, allB, 10_000n, 500n)
		expect(p0.tiltBps).toBe(500n)
		expect(p1.tiltBps).toBe(-500n)
	})

	test('mid from sqrtPriceX96 reproduces the live Base Sepolia reference', () => {
		expect(midFromSqrtPriceX96(1315805077060885543498123125042033n)).toBe(275818853000085890554200491n)
	})
})

const REF_ABI = parseAbiParameters(
	'bytes32 positionId, (uint128 mid, uint16 spreadBps, int16 tiltBps, uint40 updatedAt, uint32 seq, uint128 refBalanceA, int64 dTiltPerA, uint32 maxExtrapBps, uint16 markoutBps, uint16 bandEdgeBps) ref',
)

function decodeRef(payload: string) {
	const { decodeAbiParameters } = require('viem')
	return decodeAbiParameters(REF_ABI, `0x${Buffer.from(payload, 'base64').toString('hex')}`) as [
		string,
		{ tiltBps: number; seq: number; updatedAt: number },
	]
}
