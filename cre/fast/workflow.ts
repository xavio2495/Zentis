import {
	bigintToProtoBigInt,
	bytesToHex,
	cre,
	encodeCallMsg,
	hexToBase64,
	LAST_FINALIZED_BLOCK_NUMBER,
	LATEST_BLOCK_NUMBER,
	prepareReportRequest,
	protoBigIntToBigint,
	type Runtime,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, parseAbiParameters, type Address, type Hex } from 'viem'
import { z } from 'zod'

import { legWeight, midFromSqrtPriceX96, reservation, type LegWeight } from './policy'

// ─── Config ─────────────────────────────────────────────────
const legSchema = z.object({
	chainSelector: z.string(), // bigint as a decimal string; JSON has no bigint
	pool: z.string(), // the Uniswap v3 pool this leg prices against
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
	/** Bootstrap base half-spread, used only until the slow workflow has published a measured one. */
	spreadBps: z.number(),
	markoutBps: z.number(),
	maxTiltBps: z.number(),
	maxExtrapBps: z.number(),
	// The maker is the same on both legs, so it lives here rather than twice below. That is not
	// tidiness: the CRE runtime delivers a TRUNCATED config to the workflow once the total number of
	// leaf values crosses roughly 27, failing as
	// "Failed to parse configuration: Unexpected end of JSON input". It is a count cliff, not a size
	// one — a 1.7kB config with 18 leaves is fine, a 541-byte config with 27 is not, dropping any one
	// field fixes it, and shortening a value does not. Keep this schema under ~24 leaves.
	maker: z.string(),
	legA: legSchema,
	legB: legSchema,
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
type Stored = { mid: bigint; spreadBps: number; markoutBps: number; bandEdgeBps: number }
type Leg = z.infer<typeof legSchema>

const SLOT0_ABI = [
	{
		name: 'slot0',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [
			{ name: 'sqrtPriceX96', type: 'uint160' },
			{ name: 'tick', type: 'int24' },
			{ name: 'observationIndex', type: 'uint16' },
			{ name: 'observationCardinality', type: 'uint16' },
			{ name: 'observationCardinalityNext', type: 'uint16' },
			{ name: 'feeProtocol', type: 'uint8' },
			{ name: 'unlocked', type: 'bool' },
		],
	},
] as const

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
 * One leg's state, every read pinned to the same block.
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
): Observation => {
	const client = new cre.capabilities.EVMClient(BigInt(leg.chainSelector))

	const header = client
		.headerByNumber(don, { blockNumber: LAST_FINALIZED_BLOCK_NUMBER })
		.result().header
	if (!header?.blockNumber) throw new Error(`${name}: no finalized header`)

	const pinnedBlock = protoBigIntToBigint(header.blockNumber)
	const at = bigintToProtoBigInt(pinnedBlock)

	const slot0 = client
		.callContract(don, {
			call: encodeCallMsg({
				from: maker,
				to: leg.pool as Address,
				data: encodeFunctionData({ abi: SLOT0_ABI, functionName: 'slot0' }),
			}),
			blockNumber: at,
		})
		.result()
	const [sqrtPriceX96] = decodeAbiParameters(
		parseAbiParameters('uint160, int24, uint16, uint16, uint16, uint8, bool'),
		bytesToHex(slot0.data),
	)

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

	const mid = midFromSqrtPriceX96(sqrtPriceX96 as bigint)

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
 * The fast reference: mid, tilt and spread for both legs of one cross-chain position.
 *
 * What the enclave actually keeps confidential is the pair of gains that turn inventory into a quote
 * concession: one on the leg's own weight, one on the whole book's. Those numbers are the maker's
 * aggression — how far they will move price to shed inventory — and a node operator who could read
 * them could position against every rebalance before it happens. The pool prices and Aqua balances this workflow reads are public on-chain data
 * and are deliberately NOT treated as secret; claiming otherwise would be theatre.
 */
export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const config = runtime.config

	// Released by the Vault DON directly into the attested enclave, decrypted at this call.
	const kappaOwnBps = BigInt(runtime.getSecret({ id: config.kappaSecretId }).result().value)
	const kappaBookBps = BigInt(runtime.getSecret({ id: config.kappaBookSecretId }).result().value)

	// EVM capabilities take a DON runtime, so chain reads and writes cross back out of the enclave.
	// That is correct here: they carry no secret, and they are the part that needs consensus.
	const don = runtime.usingTheDons()

	const maker = config.maker as Address
	const observed = [
		observeLeg(don, config.legA, maker, config.positionId as Hex, 'legA'),
		observeLeg(don, config.legB, maker, config.positionId as Hex, 'legB'),
	] as [Observation, Observation]
	const policies = reservation(
		[observed[0].weight, observed[1].weight],
		kappaOwnBps,
		kappaBookBps,
		BigInt(config.maxTiltBps),
	)

	// One updatedAt and one seq across both legs: they describe a single cross-chain instant, and a
	// reader must be able to tell they came from one observation by comparing seq. The combined
	// reference is never fresher than its laggier leg, hence the min.
	const updatedAt =
		observed[0].pinnedTimestamp < observed[1].pinnedTimestamp
			? observed[0].pinnedTimestamp
			: observed[1].pinnedTimestamp
	const seq = updatedAt

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
				bandEdgeBps: o.stored.bandEdgeBps, // published by the slow workflow; zero until it has
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
 * Capability budget, sized for the WORST single execution rather than the average: per leg one
 * finalized-header read, two pinned contract reads and one report write. The published budgets are
 * doubled so that one retry, or one added read, does not take the workflow down — the audit-firewall
 * template ships a budget of exactly 8 against exactly 8 calls, which is a bug to learn from.
 */
export const restrictions = (config: Config) => ({
	capabilities: {
		type: 'CAPABILITY_RESTRICTION_TYPE_OPEN' as const,
		maxTotalCalls: 20,
		restrictions: [config.legA, config.legB].flatMap((leg) => {
			const r = new cre.restrictors.EVMRestrictor(BigInt(leg.chainSelector))
			return [r.limitHeaderByNumber(2), r.limitCallContract(6), r.limitWriteReport(2)]
		}),
	},
})
