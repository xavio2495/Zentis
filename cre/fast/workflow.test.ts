import { describe, expect } from 'bun:test'
import { test } from '@chainlink/cre-sdk/test'
import { protoBigIntToBigint, type TeeRuntime } from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters } from 'viem'

import { onCronTrigger, restrictions, type Config } from './workflow'
import { anchorTiltBps, antiSymmetric, legWeight, midFromSqrtPriceX96, ONE } from '@zentis/strategy-sdk'
import { midFromUsdPrices } from '../slow/policy'

const KAPPA = '10000'
const KAPPA_BOOK = '5000'
const API_KEY = 'not-a-real-key'

// The one market every leg is priced against: mainnet USDC/WETH, as the 1inch spot API returns it.
const MAINNET = {
	chainId: 1,
	tokenA: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
	tokenB: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
	decimalsA: 6,
	decimalsB: 18,
}
const USDC_USD = '0.9998'
const WETH_USD = '2464.71'
const MARKET_MID = midFromUsdPrices(USDC_USD, WETH_USD, MAINNET.decimalsA, MAINNET.decimalsB)

/** The tokenB balance that makes a leg exactly even at the market mid. */
const evenB = (balanceA: bigint) => (balanceA * MARKET_MID) / ONE

const config: Config = {
	schedule: '*/10 * * * * *',
	positionId: `0x${'00'.repeat(31)}01`,
	kappaSecretId: 'KAPPA_BPS',
	kappaBookSecretId: 'KAPPA_BOOK_BPS',
	apiKeySecretId: 'ONEINCH_API_KEY',
	mainnet: MAINNET,
	spreadBps: 10,
	markoutBps: 0,
	maxTiltBps: 500,
	maxExtrapBps: 100,
	maker: '0x4887B4695dEe830A341304bFEb14538E2442DD55',
	legs: [
	{
		chainSelector: '10344971235874465080',
		aqua: '0xb8790fd154f3c36c4d83e6e59f0550bae7cceff9',
		app: '0xdd9752b377870bd9e41cd041f4a0e90770d0fb41',
		strategyHash: `0x${'11'.repeat(32)}`,
		tokenA: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
		tokenB: '0x4200000000000000000000000000000000000006',
		registry: '0x2FE4cCe316287505ce114101b9d58c1f56d8E910',
	},
	{
		chainSelector: '3478487238524512106',
		aqua: '0x8F4f807C72a2BfAB4024e783f68Fc714d0Ce2bbe',
		app: '0xfc603336a7b797f2d7eba03ed69734fad9ea521b',
		strategyHash: `0x${'22'.repeat(32)}`,
		tokenA: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
		tokenB: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
		registry: '0xB7e37E396bBB785c346D1909231a9B3D2707Cd32',
	},
	],
}

const SEPOLIA_LEG = {
	chainSelector: '16015286601757825753',
	aqua: '0xF86CdAeE90DB9901a5F104172294161085070C5A',
	app: '0x57706A10f41d4649fE65de6D38c3eCe429D2d147',
	strategyHash: `0x${'33'.repeat(32)}`,
	tokenA: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
	tokenB: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
	registry: '0xA5dCB9B329b17253FF35202dEb7a2093d06fd7b0',
}
const configWithThreeLegs: Config = { ...config, legs: [...config.legs, SEPOLIA_LEG] }

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

const balancesData = (a: bigint, b: bigint) =>
	bytes(encodeAbiParameters(parseAbiParameters('uint256, uint256'), [a, b]))

/** What the registry already holds for this leg. A zero mid means nothing has been published. */
type Stored = { mid: bigint; spreadBps: number; markoutBps: number; bandEdgeBps: number; tiltBps?: number; seq?: number }
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
					tiltBps: stored.tiltBps ?? (stored.mid === 0n ? 0 : -2),
					updatedAt: stored.mid === 0n ? 0 : 1788891000,
					seq: stored.seq ?? (stored.mid === 0n ? 0 : 1788891000),
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
 * A chain that never changes: every leg's finalized block and Aqua balances are fixed, and so is the
 * market the mid is read from. Every determinism claim in this file rests on the handler being a
 * pure function of these. All three legs start even AT THAT ONE MID, which is what re-shipping them
 * against the market price produces and what three unrelated venue mids could not express.
 */
type LegState = { block: bigint; ts: bigint; bal: [bigint, bigint]; stored: Stored }
type ChainState = { legs: LegState[] }

const LEG_A: LegState = {
	block: 46561623n,
	ts: 1788891534n,
	bal: [15_000_000n, evenB(15_000_000n)],
	stored: NOTHING_STORED,
}
const LEG_B: LegState = {
	block: 306809662n,
	ts: 1788891600n,
	bal: [15_000_000n, evenB(15_000_000n)],
	stored: NOTHING_STORED,
}
const LEG_C: LegState = {
	block: 11673302n,
	ts: 1788891580n,
	bal: [15_000_000n, evenB(15_000_000n)],
	stored: NOTHING_STORED,
}

const CHAIN: ChainState = { legs: [LEG_A, LEG_B] }
const THREE: ChainState = { legs: [LEG_A, LEG_B, LEG_C] }
const withLeg = (chain: ChainState, index: number, patch: Partial<LegState>): ChainState => ({
	legs: chain.legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)),
})

/** What the spot-price endpoint answers with. */
type Market = { statusCode: number; body: string }
const MARKET: Market = {
	statusCode: 200,
	body: JSON.stringify({
		[MAINNET.tokenA.toLowerCase()]: USDC_USD,
		[MAINNET.tokenB.toLowerCase()]: WETH_USD,
	}),
}

const makeRuntime = (chain: ChainState = CHAIN, cfg: Config = config, market: Market = MARKET) => {
	const logs: string[] = []
	const reports: string[] = []
	const calls: string[] = []
	// The block each CallContract was pinned to: 'latest', or the block number as a string.
	const blockTags: string[] = []
	// Every URL the enclave fetched, so "once per run" can be counted rather than asserted in prose.
	const httpUrls: string[] = []

	// header, safeBalances, refOf — per leg, in the order observeLeg issues them.
	const queue: Array<() => unknown> = chain.legs.flatMap((leg) => [
		() => ({ header: { blockNumber: protoBigInt(leg.block), timestamp: leg.ts } }),
		() => ({ data: balancesData(leg.bal[0], leg.bal[1]) }),
		() => ({ data: storedData(leg.stored) }),
	])
	let i = 0

	const don = {
		config: cfg,
		callCapability: ({ method, payload }: { method: string; payload?: unknown }) => {
			calls.push(method)
			if (method === 'CallContract') {
				const tag = (payload as { blockNumber?: { absVal: Uint8Array; sign: bigint } }).blockNumber
				blockTags.push(
					tag && tag.sign === -1n && tag.absVal[0] === 2 ? 'latest' : String(tag ? protoBigIntToBigint(tag) : '?'),
				)
			}
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

	const secrets: Record<string, string> = {
		KAPPA_BPS: KAPPA,
		KAPPA_BOOK_BPS: KAPPA_BOOK,
		ONEINCH_API_KEY: API_KEY,
	}

	// The market read is the one capability the ENCLAVE runtime calls directly: the key it carries
	// must not cross out to the DON, so it does not go through the `don` double above.
	const runtime = {
		config: cfg,
		getSecret: ({ id }: { id: string }) => ({
			result: () => ({ value: secrets[id] ?? KAPPA }),
		}),
		callCapability: ({ method, payload }: { method: string; payload: { url: string } }) => {
			calls.push(method)
			if (method !== 'SendRequest') throw new Error(`unexpected enclave capability call: ${method}`)
			httpUrls.push(payload.url)
			return {
				result: () => ({
					statusCode: market.statusCode,
					body: new TextEncoder().encode(market.body),
				}),
			}
		},
		log: (m: string) => logs.push(m),
		usingTheDons: () => don,
	}

	return { runtime: runtime as unknown as TeeRuntime<Config>, logs, reports, calls, blockTags, httpUrls }
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
		const moved = makeRuntime(withLeg(CHAIN, 0, { bal: [20_000_000n, evenB(15_000_000n)] }))
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
		const { runtime, reports } = makeRuntime(withLeg(CHAIN, 0, { bal: [25_000_000n, evenB(15_000_000n)] }))
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
		const { runtime, reports } = makeRuntime(
			withLeg(CHAIN, 0, { stored: { mid: 1n, spreadBps: 22, markoutBps: 37, bandEdgeBps: 54 } }),
		)
		onCronTrigger(runtime)
		const [, refA] = decodeRef(reports[0]!)
		const [, refB] = decodeRef(reports[1]!)
		expect(refA.spreadBps).toBe(22)
		expect(refA.markoutBps).toBe(37)
		// The boundary is republished as the new shift plus the room the slow workflow granted,
		// which was 54 above the shift of -2 it saw.
		expect(refA.bandEdgeBps).toBe(Math.abs(refA.tiltBps) + 52)
		// Nothing published on leg B yet, so it bootstraps from the config.
		expect(refB.spreadBps).toBe(config.spreadBps)
		expect(refB.markoutBps).toBe(0)
		expect(refB.bandEdgeBps).toBe(0)
	})

	test('the slot is read at the head; every pricing input at the pinned block', () => {
		// Finality lags the head by around twenty minutes on every chain this position lives on. A
		// slot read at the finalized block misses every slow write from that window, and the fast
		// write would then carry the stale terms forward and bury the measurement for good.
		const { runtime, blockTags } = makeRuntime()
		onCronTrigger(runtime)
		expect(blockTags).toEqual([
			String(LEG_A.block),
			'latest',
			String(LEG_B.block),
			'latest',
		])
	})

	test('the boundary keeps the room the slow workflow granted, above whatever shift is now quoted', () => {
		// The instruction caps the whole shift at the published boundary. The slow workflow publishes
		// the boundary as the shift it saw plus the room it allocated, but it runs hourly and the
		// shift moves every minute; a correction larger than the stale boundary would be clamped to
		// it. So this workflow republishes the boundary as the new shift plus the same room, and
		// spends that room on the concession inside the enclave, where the budget belongs.
		const stored = { mid: 1n, spreadBps: 22, markoutBps: 0, bandEdgeBps: 57 } // room = 57 - |-2|
		// A mild excess, so the shift sits well inside the signed cap and the sum is not clamped.
		const { runtime, reports } = makeRuntime(
			withLeg(withLeg(CHAIN, 0, { stored }), 0, { bal: [15_300_000n, evenB(15_000_000n)] }),
		)
		onCronTrigger(runtime)
		const [, refA] = decodeRef(reports[0]!)
		expect(Math.abs(refA.tiltBps)).toBeLessThan(400)
		expect(refA.bandEdgeBps).toBe(Math.abs(refA.tiltBps) + 55)
		expect(refA.bandEdgeBps).toBeGreaterThan(57)
	})

	test('with no room granted the published shift is the correction alone', () => {
		const stored = { mid: 1n, spreadBps: 22, markoutBps: 0, bandEdgeBps: 2 } // room = 2 - |-2| = 0
		const bal: [bigint, bigint] = [25_000_000n, evenB(15_000_000n)]
		const { runtime, reports } = makeRuntime(withLeg(withLeg(CHAIN, 0, { stored }), 0, { bal }))
		onCronTrigger(runtime)
		const [, refA] = decodeRef(reports[0]!)
		const anchor = anchorTiltBps(
			legWeight({ balanceA: bal[0], balanceB: bal[1], mid: MARKET_MID }).weightA,
		)
		expect(BigInt(refA.tiltBps)).toBe(anchor < -500n ? -500n : anchor)
	})

	test('a rerun over the same pinned instant still lands: seq passes every stored seq', () => {
		// The registry rejects a seq that does not exceed the stored one. With seq taken from the
		// finalized timestamp alone, every run until the laggiest chain finalizes another block
		// repeats the same seq and is rejected, so a slot changed at the head (a slow write, a
		// budget) could not be carried for minutes at a time.
		const stored = { mid: 1n, spreadBps: 22, markoutBps: 0, bandEdgeBps: 57, tiltBps: -2, seq: 1788891534 }
		const { runtime, reports } = makeRuntime(withLeg(withLeg(CHAIN, 0, { stored }), 1, { stored }))
		onCronTrigger(runtime)
		const refs = reports.map((r) => decodeRef(r)[1])
		expect(refs[0]!.seq).toBe(1788891535)
		expect(refs[1]!.seq).toBe(refs[0]!.seq)
		expect(BigInt(refs[0]!.updatedAt)).toBe(LEG_A.ts)
	})

	test('a boundary on the cap is carried forward as the cap, not erased', () => {
		// Its room cannot be read back, so the concession runs free; but publishing zero would tell
		// the instruction and every reader that no boundary exists, which is false. The stored value
		// is carried until the slow workflow republishes it.
		const stored = { mid: 1n, spreadBps: 59, markoutBps: 0, bandEdgeBps: 500, tiltBps: -500 }
		const { runtime, reports } = makeRuntime(withLeg(CHAIN, 0, { stored }))
		onCronTrigger(runtime)
		const [, refA] = decodeRef(reports[0]!)
		expect(refA.bandEdgeBps).toBe(500)
	})

	test('the published seq and updatedAt are shared by both legs', () => {
		const { runtime, reports } = makeRuntime()
		onCronTrigger(runtime)
		const [, refA] = decodeRef(reports[0]!)
		const [, refB] = decodeRef(reports[1]!)
		expect(refA.seq).toBe(refB.seq)
		expect(refA.updatedAt).toBe(refB.updatedAt)
		// never fresher than the laggier leg
		expect(BigInt(refA.updatedAt)).toBe(LEG_A.ts < LEG_B.ts ? LEG_A.ts : LEG_B.ts)
	})

	test('a third leg is observed, priced with the rest of the book, and written', () => {
		// Leg C holds excess tokenA against its own mid and is repriced dear; the other two legs
		// shed a little through the book term, and all three share one instant.
		const { runtime, reports, blockTags } = makeRuntime(
			withLeg(THREE, 2, { bal: [25_000_000n, evenB(15_000_000n)] }),
			configWithThreeLegs,
		)
		onCronTrigger(runtime)
		expect(reports).toHaveLength(3)
		expect(blockTags).toHaveLength(6)
		const refs = reports.map((r) => decodeRef(r)[1])
		expect(refs[2]!.tiltBps).toBeLessThan(0)
		expect(refs[0]!.tiltBps).toBeGreaterThan(0)
		expect(refs[1]!.tiltBps).toBeGreaterThan(0)
		expect(new Set(refs.map((r) => r.seq)).size).toBe(1)
		expect(BigInt(refs[0]!.updatedAt)).toBe(LEG_A.ts)
	})

	// The defect this replaced: each leg read its own testnet pool, and three unarbitraged pools
	// quoted the same pair at 30,187, 2,583 and 4,156. `legWeight` values a leg's tokenB side at
	// its own mid, so the book concession was averaging weights measured against three unrelated
	// prices. One market read per run is what makes that average an average of comparable things.
	test('the mid is read once per run, not once per leg', () => {
		const { runtime, httpUrls } = makeRuntime(THREE, configWithThreeLegs)
		onCronTrigger(runtime)
		expect(httpUrls).toHaveLength(1)
		expect(httpUrls[0]).toContain(`/${MAINNET.chainId}/`)
		expect(httpUrls[0]!.toLowerCase()).toContain(MAINNET.tokenA.toLowerCase())
		expect(httpUrls[0]!.toLowerCase()).toContain(MAINNET.tokenB.toLowerCase())
	})

	test('every leg publishes the market mid, and all three publish the same one', () => {
		const { runtime, reports } = makeRuntime(THREE, configWithThreeLegs)
		onCronTrigger(runtime)
		const mids = reports.map((r) => decodeRef(r)[1].mid)
		expect(new Set(mids).size).toBe(1)
		expect(mids[0]).toBe(MARKET_MID)
	})

	test('legs that hold the same inventory are weighted the same, whatever chain they sit on', () => {
		// The book term's premise, checked: same balances, same weight, so the same concession.
		const lopsided: [bigint, bigint] = [17_000_000n, evenB(15_000_000n)]
		const same: ChainState = { legs: THREE.legs.map((leg) => ({ ...leg, bal: lopsided })) }
		const { runtime, reports } = makeRuntime(same, configWithThreeLegs)
		onCronTrigger(runtime)
		const refs = reports.map((r) => decodeRef(r)[1])
		expect(refs[0]!.tiltBps).not.toBe(0)
		expect(new Set(refs.map((r) => r.tiltBps)).size).toBe(1)
		expect(new Set(refs.map((r) => r.dTiltPerA)).size).toBe(1)
	})

	// A fallback to the leg's own pool would put the defect back at the one moment nobody is
	// watching. The registry keeps its last reference, the staleness ramp widens the quote, and at
	// an hour the position goes dark: that is the honest behaviour and it is already built.
	test('a failed market read publishes nothing', () => {
		const { runtime, reports } = makeRuntime(CHAIN, config, { statusCode: 502, body: '' })
		expect(() => onCronTrigger(runtime)).toThrow()
		expect(reports).toEqual([])
	})

	test('a malformed price publishes nothing rather than a zero mid', () => {
		const market = {
			statusCode: 200,
			body: JSON.stringify({
				[MAINNET.tokenA.toLowerCase()]: '0',
				[MAINNET.tokenB.toLowerCase()]: WETH_USD,
			}),
		}
		const { runtime, reports } = makeRuntime(CHAIN, config, market)
		expect(() => onCronTrigger(runtime)).toThrow()
		expect(reports).toEqual([])
	})

	test('a reply missing one side of the pair publishes nothing', () => {
		const { runtime, reports } = makeRuntime(CHAIN, config, { statusCode: 200, body: '{}' })
		expect(() => onCronTrigger(runtime)).toThrow()
		expect(reports).toEqual([])
	})

	test('the capability budget covers the calls actually made, with headroom', () => {
		const { runtime, calls } = makeRuntime(THREE, configWithThreeLegs)
		onCronTrigger(runtime)

		const made = (m: string) => calls.filter((c) => c === m).length
		const budget = restrictions(configWithThreeLegs).capabilities.restrictions
		const allowed = (m: string) =>
			budget
				.filter((r) => r.method?.method === m)
				.reduce((sum, r) => sum + (r.method?.maxCalls ?? 0), 0)

		for (const method of ['HeaderByNumber', 'CallContract', 'WriteReport', 'SendRequest']) {
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
		{ mid: bigint; tiltBps: number; seq: number; updatedAt: number; dTiltPerA: bigint },
	]
}
