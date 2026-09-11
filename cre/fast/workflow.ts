import {
	bigintToProtoBigInt,
	bytesToHex,
	cre,
	encodeCallMsg,
	hexToBase64,
	LAST_FINALIZED_BLOCK_NUMBER,
	LATEST_BLOCK_NUMBER,
	ok,
	prepareReportRequest,
	protoBigIntToBigint,
	text,
	type Runtime,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, parseAbiParameters, type Address, type Hex } from 'viem'
import { z } from 'zod'

import { legWeight, recoverRoom, reservation, type LegWeight } from '@zentis/strategy-sdk'
// The USD-pair conversion lives beside the slow workflow's own use of it rather than being copied:
// two implementations of the same price arithmetic are two prices, and the difference would be a
// mid that disagrees with the one crowding is valued at.
import { midFromUsdPrices } from '../slow/policy'

// ─── Config ─────────────────────────────────────────────────
const legSchema = z.object({
	chainSelector: z.string(), // bigint as a decimal string; JSON has no bigint
	aqua: z.string(),
	app: z.string(), // ZentisRouter, the Aqua "app" holding the strategy
	strategyHash: z.string(),
	tokenA: z.string(),
	tokenB: z.string(),
	registry: z.string(), // ZentisRefRegistry, the report receiver
})

export const configSchema = z.object({
	schedule: z.string(),
	positionId: z.string(),
	kappaSecretId: z.string(),
	kappaBookSecretId: z.string(),
	apiKeySecretId: z.string(),
	/**
	 * The real market the mid is read from: a mainnet pair, with `tokenA` naming the one that plays
	 * the role of every leg's tokenA. Not a testnet venue, and not one venue per leg — the legs run
	 * on testnets whose pools are not arbitraged, so each one quotes this pair at its own unrelated
	 * price, and a weight measured against one of those is not comparable with a weight measured
	 * against another. The decimals are the mainnet tokens' own, because the spot API answers in USD
	 * per whole token and `mid` is raw-per-raw.
	 */
	mainnet: z.object({
		chainId: z.number(),
		tokenA: z.string(),
		tokenB: z.string(),
		decimalsA: z.number(),
		decimalsB: z.number(),
	}),
	/** Bootstrap base half-spread, used only until the slow workflow has published a measured one. */
	spreadBps: z.number(),
	markoutBps: z.number(),
	maxTiltBps: z.number(),
	maxExtrapBps: z.number(),
	// The maker is the same on every leg, so it lives here rather than once per leg. (An earlier
	// note here claimed the runtime truncates configs past ~27 leaves. It does not: that was the
	// pre-hook parse failure wearing a different face, and the slow workflow runs with far more.)
	maker: z.string(),
	// One leg per chain the position lives on. Two is the minimum for a tilt to mean anything; the
	// policy and every loop below are written for N.
	legs: z.array(legSchema).min(2),
})

export type Config = z.infer<typeof configSchema>

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

const STORED_TUPLE = parseAbiParameters(
	'(uint128 mid, uint16 spreadBps, int16 tiltBps, uint40 updatedAt, uint32 seq, uint128 refBalanceA, int64 dTiltPerA, uint32 maxExtrapBps, uint16 markoutBps, uint16 bandEdgeBps)',
)

/**
 * The terms in the slot that this workflow does not own. The slow workflow measures the spread, the
 * markout and the boundary and writes them into the same slot, so a write here has to carry them
 * forward rather than rebuild the slot from config — or an hour's measurement would live for at
 * most sixty seconds. A zero mid means nothing has been published yet, and the config bootstraps.
 */
type Stored = {
	mid: bigint
	spreadBps: number
	markoutBps: number
	bandEdgeBps: number
	tiltBps: number
	seq: number
}

/**
 * Shift plus room, never zero once a boundary exists, never past the cap the maker signed. When the
 * room cannot be read back (nothing published, or a boundary on the cap) the stored boundary is
 * carried as it is: zero stays "unpublished", the cap stays the cap, until the slow workflow writes.
 */
const boundaryFor = (tiltBps: bigint, room: bigint | null, storedBoundary: number, maxTiltBps: bigint): number => {
	if (room === null) return storedBoundary
	const magnitude = tiltBps < 0n ? -tiltBps : tiltBps
	const boundary = magnitude + room
	return Number(boundary < 1n ? 1n : boundary > maxTiltBps ? maxTiltBps : boundary)
}
type Leg = z.infer<typeof legSchema>

const SAFE_BALANCES_ABI = [
	{
		name: 'safeBalances',
		type: 'function',
		stateMutability: 'view',
		inputs: [
			{ name: 'maker', type: 'address' },
			{ name: 'app', type: 'address' },
			{ name: 'strategyHash', type: 'bytes32' },
			{ name: 'token0', type: 'address' },
			{ name: 'token1', type: 'address' },
		],
		outputs: [
			{ name: 'balance0', type: 'uint256' },
			{ name: 'balance1', type: 'uint256' },
		],
	},
] as const

// The ZentisRef struct, in the order ZentisRefRegistry._processReport decodes it.
const REF_ABI = parseAbiParameters(
	'bytes32 positionId, (uint128 mid, uint16 spreadBps, int16 tiltBps, uint40 updatedAt, uint32 seq, uint128 refBalanceA, int64 dTiltPerA, uint32 maxExtrapBps, uint16 markoutBps, uint16 bandEdgeBps) ref',
)

/**
 * The one mid the whole position quotes from: raw tokenB per 1e18 raw tokenA, from the real market
 * for this pair on mainnet.
 *
 * It throws on anything it cannot trust, and in particular it never falls back to a venue price.
 * A leg that priced itself off its own pool when this read failed would silently reinstate three
 * incomparable mids at the one moment nobody is watching. Publishing nothing is the honest failure:
 * the registry keeps its last reference, the spread widens as that reference goes stale, and at an
 * hour the position goes dark — all of it already built, and all of it visible.
 *
 * The API key is decrypted into the enclave and this call is made from the enclave runtime, so the
 * key never crosses out to the DON.
 */
const readMarketMid = (runtime: TeeRuntime<Config>, apiKey: string): bigint => {
	const { chainId, tokenA, tokenB, decimalsA, decimalsB } = runtime.config.mainnet
	const a = tokenA.toLowerCase()
	const b = tokenB.toLowerCase()
	const response = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, {
			url: `https://api.1inch.dev/price/v1.1/${chainId}/${a},${b}?currency=USD`,
			method: 'GET',
			multiHeaders: { Authorization: { values: [`Bearer ${apiKey}`] } },
		})
		.result()
	if (!ok(response)) throw new Error(`market price read failed with status ${response.statusCode}`)

	const prices = JSON.parse(text(response)) as Record<string, string>
	const priceA = prices[a]
	const priceB = prices[b]
	if (priceA === undefined || priceB === undefined) {
		throw new Error('market price read returned only one side of the pair')
	}
	// A malformed or zero price converts to zero, and the registry rejects a zero mid — but a zero
	// must never reach the report in the first place, or a rejected write is the only thing standing
	// between a broken feed and an unpriced position.
	const mid = midFromUsdPrices(priceA, priceB, decimalsA, decimalsB)
	if (mid <= 0n) throw new Error('market price read produced a non-positive mid')
	return mid
}

type Observation = {
	leg: Leg
	name: string
	pinnedBlock: bigint
	pinnedTimestamp: bigint
	mid: bigint
	weight: LegWeight
	stored: Stored
}

/**
 * One leg's state, every read pinned to the same block, priced at the mid the caller read once for
 * the whole book.
 *
 * Determinism is the load-bearing property of this whole workflow: with no attestation to check us
 * during simulation, "two runs over the same pinned block produce identical bytes" is the only
 * evidence it is enclave-shaped. So the block is resolved ONCE, from the last finalized block, and
 * every subsequent read names that number explicitly. Reading at "latest" would let two nodes land on
 * different blocks and make consensus impossible to reach.
 */
const observeLeg = (
	don: Runtime<Config>,
	leg: Leg,
	maker: Address,
	positionId: Hex,
	name: string,
	mid: bigint,
): Observation => {
	const client = new cre.capabilities.EVMClient(BigInt(leg.chainSelector))

	const header = client
		.headerByNumber(don, { blockNumber: LAST_FINALIZED_BLOCK_NUMBER })
		.result().header
	if (!header?.blockNumber) throw new Error(`${name}: no finalized header`)

	const pinnedBlock = protoBigIntToBigint(header.blockNumber)
	const at = bigintToProtoBigInt(pinnedBlock)

	const balances = client
		.callContract(don, {
			call: encodeCallMsg({
				from: maker,
				to: leg.aqua as Address,
				data: encodeFunctionData({
					abi: SAFE_BALANCES_ABI,
					functionName: 'safeBalances',
					args: [
						maker,
						leg.app as Address,
						leg.strategyHash as Hex,
						leg.tokenA as Address,
						leg.tokenB as Address,
					],
				}),
			}),
			blockNumber: at,
		})
		.result()
	const [balanceA, balanceB] = decodeAbiParameters(
		parseAbiParameters('uint256, uint256'),
		bytesToHex(balances.data),
	)

	// The one read that is NOT pinned. Finality lags the head by around twenty minutes on every
	// chain this position lives on, and the slow workflow writes into the same slot at the head. A
	// slot read at the finalized block would miss every slow write from that window; this write
	// would then carry the stale terms forward, and the next finalized block would contain that
	// stale rewrite rather than the measurement. Read at the head, the terms survive; the pricing
	// inputs above stay pinned, and the report is still a pure function of them plus this slot.
	const slot = client
		.callContract(don, {
			call: encodeCallMsg({
				from: maker,
				to: leg.registry as Address,
				data: encodeFunctionData({
					abi: REF_OF_ABI,
					functionName: 'refOf',
					args: [positionId],
				}),
			}),
			blockNumber: LATEST_BLOCK_NUMBER,
		})
		.result()
	const [current] = decodeAbiParameters(STORED_TUPLE, bytesToHex(slot.data))
	const stored: Stored = {
		mid: current.mid,
		spreadBps: current.spreadBps,
		markoutBps: current.markoutBps,
		bandEdgeBps: current.bandEdgeBps,
		tiltBps: current.tiltBps,
		seq: current.seq,
	}

	return {
		leg,
		name,
		pinnedBlock,
		pinnedTimestamp: header.timestamp,
		mid,
		weight: legWeight({ balanceA: balanceA as bigint, balanceB: balanceB as bigint, mid }),
		stored,
	}
}

/**
 * The fast reference: mid, tilt and slope for every leg of one cross-chain position.
 *
 * The mid is read once, from the real mainnet market for this pair, and every leg is priced and
 * published against that one number. That is what makes the book weight an average of comparable
 * things: `legWeight` values a leg's tokenB side at the mid, so weights measured against different
 * mids cannot be averaged, and the book concession is the cross-chain signal the whole position
 * rests on.
 *
 * What the enclave actually keeps confidential is the pair of gains that turn inventory into a quote
 * concession: one on the leg's own weight, one on the whole book's. Those numbers are the maker's
 * aggression — how far they will move price to shed inventory — and a node operator who could read
 * them could position against every rebalance before it happens. The market price and the Aqua
 * balances this workflow reads are public data and are deliberately NOT treated as secret; claiming
 * otherwise would be theatre.
 */
export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const config = runtime.config

	// Released by the Vault DON directly into the attested enclave, decrypted at this call.
	const kappaOwnBps = BigInt(runtime.getSecret({ id: config.kappaSecretId }).result().value)
	const kappaBookBps = BigInt(runtime.getSecret({ id: config.kappaBookSecretId }).result().value)
	const apiKey = runtime.getSecret({ id: config.apiKeySecretId }).result().value

	// Once per run, before any leg is observed and before anything is written: one mid for the book.
	const mid = readMarketMid(runtime, apiKey)

	// EVM capabilities take a DON runtime, so chain reads and writes cross back out of the enclave.
	// That is correct here: they carry no secret, and they are the part that needs consensus.
	const don = runtime.usingTheDons()

	const maker = config.maker as Address
	const observed = config.legs.map((leg, i) =>
		observeLeg(don, leg, maker, config.positionId as Hex, `leg${i}`, mid),
	)
	// The room the slow workflow granted each leg, recovered from the boundary it published: that
	// boundary is the shift it saw plus the allocated room, and every writer keeps that difference.
	// Zero means no boundary has been published, and the concession runs free until one is.
	const room = observed.map((o) =>
		recoverRoom(BigInt(o.stored.bandEdgeBps), BigInt(o.stored.tiltBps), BigInt(config.maxTiltBps)),
	)
	const policies = reservation(
		observed.map((o) => o.weight),
		kappaOwnBps,
		kappaBookBps,
		BigInt(config.maxTiltBps),
		room,
	)

	// One updatedAt and one seq across every leg: they describe a single cross-chain instant, and a
	// reader must be able to tell they came from one observation by comparing seq. The combined
	// reference is never fresher than its laggiest leg, hence the min.
	const updatedAt = observed.reduce(
		(oldest, o) => (o.pinnedTimestamp < oldest ? o.pinnedTimestamp : oldest),
		observed[0]!.pinnedTimestamp,
	)
	// The registry rejects a seq that does not exceed the stored one, and the finalized timestamp
	// only moves when the laggiest chain finalizes another block, minutes apart. A run over the same
	// pinned instant still has something to say (a slot changed at the head, a budget to carry), so
	// seq passes every leg's stored seq, and stays one number across every leg.
	const highestStored = observed.reduce((top, o) => (o.stored.seq > top ? o.stored.seq : top), 0)
	const seq = updatedAt > BigInt(highestStored) ? updatedAt : BigInt(highestStored + 1)

	const written = observed.map((o, i) => {
		const payload = encodeAbiParameters(REF_ABI, [
			config.positionId as Hex,
			{
				mid: o.mid,
				spreadBps: o.stored.mid === 0n ? config.spreadBps : o.stored.spreadBps,
				tiltBps: Number(policies[i].tiltBps),
				updatedAt: Number(updatedAt),
				seq: Number(seq),
				refBalanceA: o.weight.balanceA,
				dTiltPerA: policies[i].dTiltPerA,
				maxExtrapBps: config.maxExtrapBps,
				markoutBps: o.stored.mid === 0n ? config.markoutBps : o.stored.markoutBps,
				// The instruction caps the whole shift at this boundary, and the slow workflow only
				// republishes it hourly, so it has to follow the shift here or a large correction would
				// be clamped to a stale one. The room stays what the slow workflow allocated.
				bandEdgeBps: boundaryFor(policies[i]!.tiltBps, room[i] ?? null, o.stored.bandEdgeBps, BigInt(config.maxTiltBps)),
			},
		])

		const report = don.report(prepareReportRequest(payload)).result()

		new cre.capabilities.EVMClient(BigInt(o.leg.chainSelector))
			.writeReport(don, { receiver: o.leg.registry, report })
			.result()

		return `${o.name}: block ${o.pinnedBlock} mid ${o.mid} tilt ${policies[i].tiltBps}bps`
	})

	// No runtime.log anywhere above. The simulator would show it, a real enclave would not, and a
	// workflow that only behaves confidentially when nobody is watching is not a confidential one.
	// Everything below this line has already left the enclave.
	return `seq ${seq} | ${written.join(' | ')}`
}

export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()

	return [
		cre.handlerInTee(
			cronTrigger.trigger({ schedule: config.schedule }),
			onCronTrigger,
			// AWS Nitro in us-west-2 is the only registered TEE type and region in this SDK version;
			// pinning both means a future addition cannot silently become acceptable.
			[{ tee: 'nitro', regions: ['us-west-2'] }],
			// NOTE: the capability budget below is deliberately NOT wired in as a `preHook`.
			// Any workflow that supplies one fails to execute on cre-sdk 1.20.0 / CLI v1.32.0 — both
			// the latest as of writing, and re-verified against them — with
			// "Failed to parse configuration: Unexpected end of JSON input" — including a plain
			// `cre.handler` with a trivial function and `preHook: () => ({})`, so it is not the TEE
			// path, the restriction contents, or this config. The budget is kept and unit-tested so
			// that wiring it back is a one-line change once the SDK accepts hooks.
		),
	]
}

/**
 * Capability budget, sized for the WORST single execution rather than the average: one market read
 * for the whole run, and per leg one finalized-header read, two contract reads and one report write.
 * The published budgets are doubled so that one retry, or one added read, does not take the workflow
 * down — the audit-firewall template ships a budget of exactly 8 against exactly 8 calls, which is a
 * bug to learn from.
 */
export const restrictions = (config: Config) => ({
	capabilities: {
		type: 'CAPABILITY_RESTRICTION_TYPE_OPEN' as const,
		maxTotalCalls: 10 * config.legs.length,
		restrictions: [
			new cre.restrictors.HTTPClientRestrictor().limitSendRequest(2),
			...config.legs.flatMap((leg) => {
				const r = new cre.restrictors.EVMRestrictor(BigInt(leg.chainSelector))
				return [r.limitHeaderByNumber(2), r.limitCallContract(4), r.limitWriteReport(2)]
			}),
		],
	},
})
