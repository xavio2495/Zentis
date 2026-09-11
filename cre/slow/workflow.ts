import {
	bigintToProtoBigInt,
	bytesToHex,
	cre,
	encodeCallMsg,
	LATEST_BLOCK_NUMBER,
	ok,
	prepareReportRequest,
	protoBigIntToBigint,
	text,
	type Runtime,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import {
	decodeAbiParameters,
	encodeAbiParameters,
	encodeFunctionData,
	parseAbiParameters,
	type Address,
	type Hex,
} from 'viem'
import { z } from 'zod'

import { BPS, midFromSqrtPriceX96, volatilitySpreadBps, type PriceSample } from '@zentis/strategy-sdk'
import {
	allocateBandEdge,
	crowdingBpsOf,
	markoutBps,
	midFromUsdPrices,
	publishedBoundary,
	toBase64,
	type MarkoutFill,
	type MarkoutReference,
} from './policy'

// ─── Config ─────────────────────────────────────────────────
/** Where a reference gets written: one Zentis leg, on a testnet. */
const legSchema = z.object({
	chainSelector: z.string(),
	registry: z.string(),
	/**
	 * This leg's fills subgraph. Markout is a per-venue measurement — the flow one leg sees is not
	 * the flow the other sees — so each leg is scored against its own indexed history.
	 */
	fillsSubgraphUrl: z.string(),
	/**
	 * The standardized Aqua subgraph for the mainnet this leg corresponds to, and the pair to read
	 * from it. Empty means no positioning data for this leg, which allocates it the full budget —
	 * absence of evidence about crowding is not evidence of it.
	 *
	 * The position runs on testnets and the crowding is a mainnet fact, for the same reason the
	 * impulse boundary is priced from a mainnet quote: what it costs to compete for corrective flow
	 * in this pair is a real-market quantity, and a testnet venue has no maker base to measure.
	 */
	crowdingSubgraphUrl: z.string().default(''),
	/**
	 * The two mainnet tokens of the venue pair, with `crowdingTokenA` naming the one that plays the
	 * role of THIS leg's tokenA. The standardized schema keys a pair in address order, and address
	 * order on the mainnet need not match address order on the testnet the leg runs on — so without
	 * this the crowding sign would be measured against the opposite token from our own lean, and the
	 * contested test would be inverted rather than merely noisy.
	 */
	crowdingTokenA: z.string().default(''),
	crowdingTokenB: z.string().default(''),
	/**
	 * Where the venue's tokens are priced: the mainnet chain id the pair lives on and the tokens'
	 * decimals, so crowding is valued at a mainnet mid rather than at this testnet leg's own.
	 */
	crowdingChainId: z.number().default(0),
	crowdingDecimalsA: z.number().default(0),
	crowdingDecimalsB: z.number().default(0),
})

/**
 * What the boundary is priced against: the real Base↔Arbitrum USDC route, on MAINNET.
 *
 * Not a shortcut. Fusion+ rejects testnet chain ids outright
 * (`INVALID_CHAIN_ID` for 421614), and more importantly a testnet quote would be meaningless: the
 * quantity we need is what it actually costs to move a maker's inventory between these two chains,
 * and that is a mainnet price. The position lives on testnets; the cost of the alternative to
 * tilting does not.
 */
const quoteSchema = z.object({
	srcChainId: z.number(),
	dstChainId: z.number(),
	srcToken: z.string(),
	dstToken: z.string(),
	srcDecimals: z.number(),
	dstDecimals: z.number(),
	amount: z.string(),
	walletAddress: z.string(),
})

export const configSchema = z.object({
	schedule: z.string(),
	positionId: z.string(),
	apiKeySecretId: z.string(),
	quoteUrl: z.string(),
	quote: quoteSchema,
	/** Floor under the published boundary, so a quiet hour can never pin the band shut. */
	minBandEdgeBps: z.number(),
	/** Ceiling, so a broken quote cannot widen it past what the maker would accept. */
	maxBandEdgeBps: z.number(),
	/** How long after a fill the reference is read to score it. */
	markoutHorizonSeconds: z.number(),
	/**
	 * Ceiling on the published markout. The spread instruction reverts the whole swap when the base
	 * spread, this term and the soft-bound widen sum past the full basis, so an unbounded markout
	 * would not widen a leg, it would brick it.
	 */
	markoutCapBps: z.number(),
	/** How many recent fills and references to score over. */
	markoutWindow: z.number(),
	/** The base half-spread the volatility term widens. Once published it replaces the fast workflow's bootstrap value. */
	baseSpreadBps: z.number(),
	/** The reference cadence: how long a quote can be stale before it is repriced, which is the move the spread must cover. */
	volatilityHorizonSeconds: z.number(),
	/** How far back the price series reaches, from its newest sample rather than from a clock. */
	volatilityWindowSeconds: z.number(),
	/** How many standard deviations of the move over the horizon the spread covers, in bps of one. */
	volatilityMultiplierBps: z.number(),
	/**
	 * Where the price series is measured: the same mainnet market the mid is read from, through The
	 * Graph's decentralised gateway. ONE series for the whole book, not one per leg — the spread has
	 * to cover the move of the number the legs actually quote from, and that is one number now.
	 *
	 * Measuring it on each leg's own testnet pool priced risk the position does not carry: those
	 * pools are not arbitraged, so their moves are venue noise, and a term built from them widened
	 * the legs for something that was never going to reach a taker.
	 */
	volatility: z.object({
		subgraphUrl: z.string(),
		/** The pool inside that subgraph, with token0 playing the role of every leg's tokenA. */
		pool: z.string(),
		apiKeySecretId: z.string(),
	}),
	/** Ceiling on the term: a wild series widens a leg, it does not brick it. */
	volatilityCapBps: z.number(),
	/** The secret holding how hard the maker responds to a crowded venue. */
	congestionSecretId: z.string(),
	/** Floor under an allocated budget. Never zero: zero reads as "nothing published" on-chain. */
	minAllocatedEdgeBps: z.number(),
	legs: z.array(legSchema).min(2),
})

export type Config = z.infer<typeof configSchema>

const REF_TUPLE = parseAbiParameters(
	'(uint128 mid, uint16 spreadBps, int16 tiltBps, uint40 updatedAt, uint32 seq, uint128 refBalanceA, int64 dTiltPerA, uint32 maxExtrapBps, uint16 markoutBps, uint16 bandEdgeBps)',
)
const REPORT_ABI = parseAbiParameters(
	'bytes32 positionId, (uint128 mid, uint16 spreadBps, int16 tiltBps, uint40 updatedAt, uint32 seq, uint128 refBalanceA, int64 dTiltPerA, uint32 maxExtrapBps, uint16 markoutBps, uint16 bandEdgeBps) ref',
)

const REF_OF_ABI = [
	{
		name: 'refOf',
		type: 'function',
		stateMutability: 'view',
		inputs: [{ name: 'id', type: 'bytes32' }],
		outputs: [
			{
				name: '',
				type: 'tuple',
				components: [
					{ name: 'mid', type: 'uint128' },
					{ name: 'spreadBps', type: 'uint16' },
					{ name: 'tiltBps', type: 'int16' },
					{ name: 'updatedAt', type: 'uint40' },
					{ name: 'seq', type: 'uint32' },
					{ name: 'refBalanceA', type: 'uint128' },
					{ name: 'dTiltPerA', type: 'int64' },
					{ name: 'maxExtrapBps', type: 'uint32' },
					{ name: 'markoutBps', type: 'uint16' },
					{ name: 'bandEdgeBps', type: 'uint16' },
				],
			},
		],
	},
] as const

export type StoredRef = {
	mid: bigint
	spreadBps: number
	tiltBps: number
	updatedAt: number
	seq: number
	refBalanceA: bigint
	dTiltPerA: bigint
	maxExtrapBps: number
	markoutBps: number
	bandEdgeBps: number
}

/**
 * The impulse boundary, from what it actually costs to move inventory between the two legs.
 *
 * A Fusion+ cross-chain quote for moving `quoteAmount` from leg A to leg B tells us the round-trip
 * cost of doing physically what the tilt does synthetically. That cost IS the boundary: tilting
 * harder than it would be cheaper to bridge, so the band should never admit a concession wider than
 * the alternative. `dstAmount` comes back in the destination token's raw units, so the shortfall
 * against a perfect 1:1 move, in bps, is the number we want.
 */
export const bandEdgeFromQuote = (
	sentRaw: bigint,
	receivedRaw: bigint,
	srcDecimals: number,
	dstDecimals: number,
): bigint => {
	// Both sides are USD-denominated stablecoin legs, so the only conversion is decimals.
	const sentNormalised =
		srcDecimals >= dstDecimals
			? sentRaw / 10n ** BigInt(srcDecimals - dstDecimals)
			: sentRaw * 10n ** BigInt(dstDecimals - srcDecimals)
	if (sentNormalised === 0n) throw new Error('quote amount normalises to zero')
	if (receivedRaw >= sentNormalised) return 0n

	// Bucketed to the NEAREST basis point, deliberately, and this is the whole reason the slow
	// workflow can be hourly: a venue quote moves continuously, so publishing it raw would write a
	// different number every hour and burn a seq on noise. Rounded to a bp, a quiet hour produces the
	// same value and the write is a no-op the registry rejects on seq.
	const tenthsOfBps = ((sentNormalised - receivedRaw) * BPS * 10n) / sentNormalised
	return (tenthsOfBps + 5n) / 10n
}

const clampBps = (v: bigint, lo: bigint, hi: bigint) => (v < lo ? lo : v > hi ? hi : v)

/**
 * One document, sent unchanged to whichever leg's subgraph is being scored.
 *
 * Both legs are indexed against the same standardized schema, so the enclave does not branch on
 * which chain it is asking. The fills carry the direction and both amounts; the references carry the
 * mid and the timestamp of the block it described, which is what a fill is scored against.
 */
const MARKOUT_QUERY = `query Markout($positionId: ID!, $window: Int!) {
  position(id: $positionId) {
    fills(orderBy: timestamp, orderDirection: desc, first: $window) {
      timestamp
      isAToB
      amountIn
      amountOut
    }
    references(orderBy: seq, orderDirection: desc, first: $window) {
      updatedAt
      mid
    }
  }
}`

const VOLATILITY_QUERY = `query Volatility($pool: String!) {
  swaps(where: { pool: $pool }, orderBy: timestamp, orderDirection: desc, first: 1000) {
    timestamp
    sqrtPriceX96
  }
}`

type VolatilityResponse = {
	data?: { swaps: { timestamp: string; sqrtPriceX96: string }[] }
	errors?: { message: string }[]
}

type MarkoutResponse = {
	data?: {
		position: {
			fills: { timestamp: string; isAToB: boolean; amountIn: string; amountOut: string }[]
			references: { updatedAt: string; mid: string }[]
		} | null
	}
	errors?: { message: string }[]
}

const CROWDING_QUERY = `query Crowding($id: ID!) {
  venuePair(id: $id) {
    tokenA
    totalCommittedA
    totalCommittedB
    activePositions
    distinctMakers
    distinctApps
  }
}`

type CrowdingResponse = {
	data?: {
		venuePair: {
			tokenA: string
			totalCommittedA: string
			totalCommittedB: string
			activePositions: number
			distinctMakers: number
			distinctApps: number
		} | null
	}
	errors?: { message: string }[]
}

/**
 * How the whole venue is positioned in this leg's pair, in basis points, from the standardized
 * Aqua schema.
 *
 * A leg with no configured source, or a pair no maker holds, reads as zero — which the allocation
 * treats as no evidence and leaves at full budget. Failing loudly here would take the whole
 * reference publish down over a signal that is an optimisation, not a correctness requirement.
 */
const readCrowding = (
	runtime: TeeRuntime<Config>,
	leg: z.infer<typeof legSchema>,
	mid: bigint,
): bigint => {
	if (leg.crowdingSubgraphUrl === '' || leg.crowdingTokenA === '' || leg.crowdingTokenB === '') {
		return 0n
	}
	// The pair id is the two token addresses concatenated in address order, which is how the
	// standardized schema keys a venue pair.
	const a = leg.crowdingTokenA.toLowerCase().replace('0x', '')
	const b = leg.crowdingTokenB.toLowerCase().replace('0x', '')
	const id = a < b ? `0x${a}${b}` : `0x${b}${a}`

	const body = JSON.stringify({ query: CROWDING_QUERY, variables: { id } })
	const response = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, {
			url: leg.crowdingSubgraphUrl,
			method: 'POST',
			multiHeaders: { 'Content-Type': { values: ['application/json'] } },
			body: toBase64(new TextEncoder().encode(body)),
		})
		.result()

	if (!ok(response)) return 0n
	const payload = JSON.parse(text(response)) as CrowdingResponse
	if (payload.errors && payload.errors.length > 0) return 0n
	const pair = payload.data?.venuePair
	if (!pair) return 0n

	// Re-orient the venue's totals so that "A" means this leg's tokenA, which is what `mid` is
	// denominated against and what our own lean is signed against.
	const matches = pair.tokenA.toLowerCase() === leg.crowdingTokenA.toLowerCase()
	const totalA = BigInt(matches ? pair.totalCommittedA : pair.totalCommittedB)
	const totalB = BigInt(matches ? pair.totalCommittedB : pair.totalCommittedA)

	return crowdingBpsOf(totalA, totalB, mid)
}

/**
 * What this leg's recent flow has cost the maker, in basis points of half-spread.
 *
 * The measurement runs inside the enclave and only its result is published. The horizon, the
 * weighting and the cap are the maker's model and stay here; the number the instruction adds is
 * necessarily public, because the instruction reads it on-chain to price with. Claiming the value
 * itself is secret would be false.
 *
 * A leg with no matured fills scores zero, which is the right default: absence of evidence about
 * adverse selection is not evidence of it.
 */
export type LegSignals = {
	markoutBps: bigint
	/** Newest indexed mid for this leg, reused to value the venue's inventory. */
	mid: bigint
}

const readMarkout = (
	runtime: TeeRuntime<Config>,
	leg: z.infer<typeof legSchema>,
	positionId: Hex,
): LegSignals => {
	const config = runtime.config
	const body = JSON.stringify({
		query: MARKOUT_QUERY,
		variables: { positionId, window: config.markoutWindow },
	})

	const response = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, {
			url: leg.fillsSubgraphUrl,
			method: 'POST',
			multiHeaders: { 'Content-Type': { values: ['application/json'] } },
			body: toBase64(new TextEncoder().encode(body)),
		})
		.result()

	if (!ok(response)) {
		throw new Error(`fills subgraph failed with status ${response.statusCode}`)
	}

	const payload = JSON.parse(text(response)) as MarkoutResponse
	if (payload.errors && payload.errors.length > 0) {
		throw new Error(`fills subgraph returned an error: ${payload.errors[0]?.message}`)
	}

	const position = payload.data?.position
	if (!position) return { markoutBps: 0n, mid: 0n }

	const fills: MarkoutFill[] = position.fills.map((f) => ({
		timestamp: BigInt(f.timestamp),
		isAToB: f.isAToB,
		amountIn: BigInt(f.amountIn),
		amountOut: BigInt(f.amountOut),
	}))
	const references: MarkoutReference[] = position.references.map((r) => ({
		updatedAt: BigInt(r.updatedAt),
		mid: BigInt(r.mid),
	}))

	// `references` comes back newest-first, so the head is the current mid.
	const newest = references.length > 0 ? (references[0] as MarkoutReference).mid : 0n

	return {
		markoutBps: markoutBps(
			fills,
			references,
			BigInt(config.markoutHorizonSeconds),
			BigInt(config.markoutCapBps),
		).publishedBps,
		mid: newest,
	}
}

/**
 * The volatility term for one leg, measured off the indexed swaps of its reference pool.
 *
 * The window is anchored on the newest indexed swap, not on a clock: the enclave has none it can
 * trust, and a series that ends where the index ends is the same series on every node.
 */
/**
 * A page of indexed swaps, newest-first as the gateway answers, turned into the ascending series the
 * estimator wants.
 *
 * The window is anchored on the newest indexed swap, not on a clock: the enclave has none it can
 * trust, and a series that ends where the index ends is the same series on every node. On this
 * market one page reaches back a couple of hours rather than the configured week, so the page length
 * is what sets the sample; that is fine for a sixty-second horizon and it is measured, not assumed.
 *
 * token0 plays the role of every leg's tokenA, so `sqrtPriceX96` already gives raw tokenB per 1e18
 * raw tokenA and nothing is inverted — the same scale as `mid`, and no decimals handling anywhere.
 */
export const marketSamples = (
	swaps: { timestamp: string; sqrtPriceX96: string }[],
	windowSeconds: bigint,
): PriceSample[] => {
	if (swaps.length === 0) return []
	const newest = BigInt((swaps[0] as { timestamp: string }).timestamp)
	return swaps
		.filter((s) => newest - BigInt(s.timestamp) <= windowSeconds)
		.map((s) => ({ timestamp: BigInt(s.timestamp), mid: midFromSqrtPriceX96(BigInt(s.sqrtPriceX96)) }))
		.reverse()
}

/**
 * The volatility term, measured once per run on the market the whole book quotes from.
 *
 * An empty series publishes no term. Absence of a series is not evidence of calm, but a spread that
 * widened on missing data would brick every leg for one broken URL, and the staleness ramp already
 * covers a reference that stops arriving.
 */
const readVolatility = (runtime: TeeRuntime<Config>, apiKey: string): bigint => {
	const config = runtime.config
	const body = JSON.stringify({
		query: VOLATILITY_QUERY,
		variables: { pool: config.volatility.pool.toLowerCase() },
	})
	const response = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, {
			url: config.volatility.subgraphUrl,
			method: 'POST',
			multiHeaders: {
				'Content-Type': { values: ['application/json'] },
				// The gateway also takes the key in the path. It goes in a header so it is not part
				// of the URL, which is the part that ends up in a log line.
				Authorization: { values: [`Bearer ${apiKey}`] },
			},
			body: toBase64(new TextEncoder().encode(body)),
		})
		.result()
	if (!ok(response)) throw new Error(`market subgraph failed with status ${response.statusCode}`)

	const payload = JSON.parse(text(response)) as VolatilityResponse
	if (payload.errors && payload.errors.length > 0) {
		throw new Error(`market subgraph returned an error: ${payload.errors[0]?.message}`)
	}
	const samples = marketSamples(payload.data?.swaps ?? [], BigInt(config.volatilityWindowSeconds))
	if (samples.length === 0) return 0n

	return volatilitySpreadBps(
		samples,
		BigInt(config.volatilityHorizonSeconds),
		BigInt(config.volatilityMultiplierBps),
		BigInt(config.volatilityCapBps),
	)
}

/**
 * The slot as it stands at the head, not at the finalized block. The registry's seq guard compares
 * against the head, and finality lags it by around twenty minutes on every chain this position
 * lives on, while the fast workflow writes every minute. A read-modify-write against the finalized
 * slot would therefore be stale on every run, and rejected on every run.
 */
/**
 * The mainnet mid the venue's crowding is valued at, from the 1inch spot-price API. The key never
 * leaves the enclave. A failed read returns zero, which the caller treats as no evidence about
 * crowding and allocates the leg its full budget — a broken price feed must not throttle a leg.
 */
const readMainnetMid = (runtime: TeeRuntime<Config>, leg: z.infer<typeof legSchema>, apiKey: string): bigint => {
	const a = leg.crowdingTokenA.toLowerCase()
	const b = leg.crowdingTokenB.toLowerCase()
	const response = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, {
			url: `https://api.1inch.dev/price/v1.1/${leg.crowdingChainId}/${a},${b}?currency=USD`,
			method: 'GET',
			multiHeaders: { Authorization: { values: [`Bearer ${apiKey}`] } },
		})
		.result()
	if (!ok(response)) return 0n
	const prices = JSON.parse(text(response)) as Record<string, string>
	const priceA = prices[a]
	const priceB = prices[b]
	if (priceA === undefined || priceB === undefined) return 0n
	return midFromUsdPrices(priceA, priceB, leg.crowdingDecimalsA, leg.crowdingDecimalsB)
}

const readRef = (don: Runtime<Config>, leg: z.infer<typeof legSchema>, positionId: Hex): StoredRef => {
	const client = new cre.capabilities.EVMClient(BigInt(leg.chainSelector))
	const reply = client
		.callContract(don, {
			call: encodeCallMsg({
				from: leg.registry as Address,
				to: leg.registry as Address,
				data: encodeFunctionData({ abi: REF_OF_ABI, functionName: 'refOf', args: [positionId] }),
			}),
			blockNumber: LATEST_BLOCK_NUMBER,
		})
		.result()

	const [ref] = decodeAbiParameters(REF_TUPLE, bytesToHex(reply.data))
	return ref as unknown as StoredRef
}

/**
 * The slow reference: one number, published hourly.
 *
 * It is a read-modify-write, not a fresh reference. There is one ZentisRef slot per position and the
 * fast workflow owns everything else in it, so this workflow reads the current reference, changes
 * only `bandEdgeBps`, and bumps `seq`. If the two race, the loser's write is rejected by the
 * registry's own seq guard — which emits and returns rather than reverting, precisely so that a
 * losing writer is not retried forever.
 */
export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const config = runtime.config
	const positionId = config.positionId as Hex

	// The API key never leaves the enclave, and neither does the quote payload it fetches: the size
	// and direction of the maker's hypothetical rebalance is exactly what a front-runner would want.
	const apiKey = runtime.getSecret({ id: config.apiKeySecretId }).result().value

	const response = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, {
			url:
				`${config.quoteUrl}?srcChain=${config.quote.srcChainId}&dstChain=${config.quote.dstChainId}` +
				`&srcTokenAddress=${config.quote.srcToken}&dstTokenAddress=${config.quote.dstToken}` +
				`&amount=${config.quote.amount}&walletAddress=${config.quote.walletAddress}&enableEstimate=false`,
			method: 'GET',
			multiHeaders: { Authorization: { values: [`Bearer ${apiKey}`] } },
		})
		.result()

	if (!ok(response)) {
		throw new Error(`Fusion+ quote failed with status ${response.statusCode}`)
	}

	// `dstTokenAmount`, not `dstAmount` — the Fusion+ quoter names it differently from the classic
	// swap API, and the difference is silent (undefined -> BigInt(undefined) throws late).
	const received = BigInt(JSON.parse(text(response)).dstTokenAmount)
	const edge = clampBps(
		bandEdgeFromQuote(
			BigInt(config.quote.amount),
			received,
			config.quote.srcDecimals,
			config.quote.dstDecimals,
		),
		BigInt(config.minBandEdgeBps),
		BigInt(config.maxBandEdgeBps),
	)

	// Everything that touches the maker's model happens here, inside the enclave, and only the
	// reduced numbers cross out: the markout horizon and weighting, and how hard to respond to a
	// crowded venue. The crowding itself is public Aqua data and is not treated as secret.
	const congestionBps = BigInt(runtime.getSecret({ id: config.congestionSecretId }).result().value)

	const signals = config.legs.map((leg) => readMarkout(runtime, leg, positionId))
	// One market, one series, one term: the spread covers the move of the mid every leg quotes from,
	// and that is a single number now. A per-leg term would be pricing a per-leg risk that the
	// position stopped carrying the moment the legs stopped pricing off their own venues.
	const graphApiKey = runtime.getSecret({ id: config.volatility.apiKeySecretId }).result().value
	const volatility = readVolatility(runtime, graphApiKey)
	const crowding = config.legs.map((leg, i) => {
		// The venue is on a mainnet; value it at a mainnet mid when the leg names one, and only
		// fall back to the leg's own mid when it does not.
		const mid = leg.crowdingChainId === 0 ? (signals[i] as LegSignals).mid : readMainnetMid(runtime, leg, apiKey)
		return mid === 0n ? 0n : readCrowding(runtime, leg, mid)
	})

	const don = runtime.usingTheDons()

	const current = config.legs.map((leg) => readRef(don, leg, positionId))

	// Our own lean on each leg is the sign of the tilt already published there: the asset we are
	// actually discounting, whether the anchor or the skew put us there. A leg where we discount the
	// same asset as the rest of the venue is contested, and gets a smaller share of the budget.
	const ownLeans = current.map((ref) => BigInt(ref.tiltBps))
	const edges = allocateBandEdge(
		edge,
		ownLeans,
		crowding,
		congestionBps,
		BigInt(config.minAllocatedEdgeBps),
		BigInt(config.maxBandEdgeBps),
	)

	const written = config.legs.map((leg, index) => {
		const ref = current[index] as StoredRef
		const payload = encodeAbiParameters(REPORT_ABI, [
			positionId,
			{
				...ref,
				spreadBps: config.baseSpreadBps + Number(volatility),
				bandEdgeBps: Number(
					publishedBoundary(
						BigInt(ref.tiltBps),
						edges[index] as bigint,
						BigInt(config.minAllocatedEdgeBps),
						BigInt(config.maxBandEdgeBps),
					),
				),
				markoutBps: Number((signals[index] as LegSignals).markoutBps),
				seq: ref.seq + 1,
			},
		])
		const report = don.report(prepareReportRequest(payload)).result()
		new cre.capabilities.EVMClient(BigInt(leg.chainSelector))
			.writeReport(don, { receiver: leg.registry, report })
			.result()
		return (
			`${leg.registry}: seq ${ref.seq} -> ${ref.seq + 1}, ` +
			`spreadBps ${config.baseSpreadBps}+${volatility}, ` +
			`bandEdgeBps ${edges[index]}, markoutBps ${(signals[index] as LegSignals).markoutBps}, ` +
			`crowdingBps ${crowding[index]}`
		)
	})

	return `baseEdgeBps ${edge} | ${written.join(' | ')}`
}

export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()
	return [
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
