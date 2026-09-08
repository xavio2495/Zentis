import {
	bigintToProtoBigInt,
	bytesToHex,
	cre,
	encodeCallMsg,
	LAST_FINALIZED_BLOCK_NUMBER,
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

import { BPS } from './policy'

// ─── Config ─────────────────────────────────────────────────
/** Where a reference gets written: one Zentis leg, on a testnet. */
const legSchema = z.object({
	chainSelector: z.string(),
	registry: z.string(),
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
	legA: legSchema,
	legB: legSchema,
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

const readRef = (don: Runtime<Config>, leg: z.infer<typeof legSchema>, positionId: Hex): StoredRef => {
	const client = new cre.capabilities.EVMClient(BigInt(leg.chainSelector))
	const header = client
		.headerByNumber(don, { blockNumber: LAST_FINALIZED_BLOCK_NUMBER })
		.result().header
	if (!header?.blockNumber) throw new Error('no finalized header')

	const reply = client
		.callContract(don, {
			call: encodeCallMsg({
				from: leg.registry as Address,
				to: leg.registry as Address,
				data: encodeFunctionData({ abi: REF_OF_ABI, functionName: 'refOf', args: [positionId] }),
			}),
			blockNumber: bigintToProtoBigInt(protoBigIntToBigint(header.blockNumber)),
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

	const don = runtime.usingTheDons()

	const written = [config.legA, config.legB].map((leg) => {
		const current = readRef(don, leg, positionId)
		const payload = encodeAbiParameters(REPORT_ABI, [
			positionId,
			{ ...current, bandEdgeBps: Number(edge), seq: current.seq + 1 },
		])
		const report = don.report(prepareReportRequest(payload)).result()
		new cre.capabilities.EVMClient(BigInt(leg.chainSelector))
			.writeReport(don, { receiver: leg.registry, report })
			.result()
		return `${leg.registry}: seq ${current.seq} -> ${current.seq + 1}`
	})

	return `bandEdgeBps ${edge} | ${written.join(' | ')}`
}

export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()
	return [
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
