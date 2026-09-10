/**
 * The slow workflow's own policy: markout, the crowding-weighted budget, the published boundary and
 * venue crowding. The reservation policy, the leg weight and realised volatility live in
 * `@zentis/strategy-sdk`, shared with the fast workflow and the console.
 */

import { BPS, ONE, truncDiv } from '@zentis/strategy-sdk'
export { BPS, ONE, truncDiv } from '@zentis/strategy-sdk'


/**
 * Adverse-selection markout, measured off indexed fills.
 *
 * The maker loses to adverse selection when the takers who trade with it are, on average, right
 * about where the price is going. Markout measures that directly: take the price a fill executed
 * at, compare it against the reference some fixed time later, and sign it from the maker's side.
 * Negative is adverse selection, and its magnitude is what the half-spread has to widen by for the
 * flow to break even.
 *
 * This mirrors `reference_model.markout` exactly, including the truncating division, so the two
 * implementations can be pinned against each other by fixture vectors.
 */

export type MarkoutFill = {
	/** block timestamp of the fill */
	timestamp: bigint
	/** true when the taker supplied tokenA, so the maker BOUGHT tokenA */
	isAToB: boolean
	amountIn: bigint
	amountOut: bigint
}

export type MarkoutReference = {
	/** timestamp of the block the workflow queried, not of the write */
	updatedAt: bigint
	mid: bigint
}

/** The price a fill executed at, in raw tokenB per 1e18 raw tokenA — the same scale as `mid`. */
export const fillPrice = (fill: MarkoutFill): bigint => {
	if (fill.amountIn <= 0n || fill.amountOut <= 0n) throw new Error('a fill with a zero leg has no price')
	return fill.isAToB
		? (fill.amountOut * ONE) / fill.amountIn
		: (fill.amountIn * ONE) / fill.amountOut
}

/** The fill's size in raw tokenA, which is the side both directions have in common. */
export const fillSizeInA = (fill: MarkoutFill): bigint => (fill.isAToB ? fill.amountIn : fill.amountOut)

/** The first published mid at or after a timestamp, or null when the fill has not matured yet. */
export const midAfter = (references: MarkoutReference[], atOrAfter: bigint): bigint | null => {
	let best: MarkoutReference | null = null
	for (const ref of references) {
		if (ref.updatedAt < atOrAfter) continue
		if (best === null || ref.updatedAt < best.updatedAt) best = ref
	}
	return best === null ? null : best.mid
}

/** Signed markout for one fill, in basis points, from the maker's side. */
export const fillMarkoutBps = (isAToB: boolean, price: bigint, laterMid: bigint): bigint => {
	if (laterMid <= 0n) throw new Error('mid must be positive')
	const raw = truncDiv((laterMid - price) * BPS, laterMid)
	return isAToB ? raw : -raw
}

export type Markout = {
	matured: number
	skipped: number
	/** size-weighted signed markout; negative is adverse selection */
	weightedBps: bigint
	/** the term the spread instruction adds: negated, floored at zero, then capped */
	publishedBps: bigint
}

/**
 * Weighting is by size in raw tokenA, so one large fill is not outvoted by a handful of dust ones.
 *
 * The result is negated and floored at zero, then capped. Floored because a favourable markout must
 * not narrow the spread — widening when flow has been costly is risk management, narrowing when it
 * has been kind is paying takers for having been wrong. Capped because the instruction reverts the
 * whole swap when the base spread, this term and the soft-bound widen sum past the full basis, so an
 * unbounded markout would not widen a leg, it would brick it.
 */
export const markoutBps = (
	fills: MarkoutFill[],
	references: MarkoutReference[],
	horizonSeconds: bigint,
	capBps: bigint,
): Markout => {
	if (capBps < 0n) throw new Error('cap must not be negative')

	let weightedSum = 0n
	let totalWeight = 0n
	let matured = 0
	let skipped = 0

	for (const fill of fills) {
		const later = midAfter(references, fill.timestamp + horizonSeconds)
		if (later === null) {
			skipped += 1
			continue
		}
		const size = fillSizeInA(fill)
		weightedSum += fillMarkoutBps(fill.isAToB, fillPrice(fill), later) * size
		totalWeight += size
		matured += 1
	}

	const weighted = totalWeight === 0n ? 0n : truncDiv(weightedSum, totalWeight)
	const floored = weighted < 0n ? -weighted : 0n
	return { matured, skipped, weightedBps: weighted, publishedBps: floored > capBps ? capBps : floored }
}

/**
 * Base64 for arbitrary bytes.
 *
 * The HTTP capability takes its request body as protobuf `bytes`, whose JSON form is base64, and a
 * GraphQL query has to be POSTed because the endpoint does not serve queries over GET. The workflow
 * runtime is neither a browser nor Node, so there is no `btoa` and no `Buffer` to lean on.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const toBase64 = (bytes: Uint8Array): string => {
	let out = ''
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i] as number
		const b1 = bytes[i + 1]
		const b2 = bytes[i + 2]
		out += B64[b0 >> 2]
		out += B64[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]
		out += b1 === undefined ? '=' : B64[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]
		out += b2 === undefined ? '=' : B64[b2 & 0x3f]
	}
	return out
}

/**
 * Crowding-weighted allocation of the rebalancing budget across legs.
 *
 * The budget is `bandEdgeBps`, which on-chain can only ever tighten the cap the maker signed. So
 * allocating it means deciding, per leg, how much concession the maker is willing to bid — a
 * different question from how far out of balance the leg is, which is the tilt's job.
 *
 * A leg is throttled exactly when our own lean and the venue's lean point the same way: there we
 * are bidding for the same corrective takers as everyone else and would have to out-concede them.
 * A leg the venue leans *against* keeps its full budget, because there we are the natural
 * counterparty and the flow arrives without paying up.
 *
 * `strength` is the maker's own aggression and never leaves the enclave. `crowding` is computed
 * from public Aqua events and is deliberately not secret. Mirrors `reference_model.allocation`.
 */

const sign = (v: bigint): bigint => (v === 0n ? 0n : v > 0n ? 1n : -1n)

/** How much of the venue's lean works against us on this leg. Zero unless the signs agree. */
export const contestedBps = (ownLean: bigint, crowdingBps: bigint): bigint => {
	const a = sign(ownLean)
	const b = sign(crowdingBps)
	if (a === 0n || b === 0n || a !== b) return 0n
	return crowdingBps < 0n ? -crowdingBps : crowdingBps
}

export const allocateBandEdge = (
	baseEdgeBps: bigint,
	ownLeans: bigint[],
	crowdingBps: bigint[],
	strengthBps: bigint,
	minEdgeBps: bigint,
	maxEdgeBps: bigint,
): bigint[] => {
	if (ownLeans.length !== crowdingBps.length)
		throw new Error('every leg needs both its own lean and its venue\'s')
	if (baseEdgeBps < 0n || strengthBps < 0n)
		throw new Error('neither the budget nor the aggression may be negative')
	// Zero means "nothing has been published" to the instruction, so an allocation must never
	// produce it: a throttled leg would silently become an unbounded one.
	if (minEdgeBps < 1n) throw new Error('the floor must be at least 1, because 0 reads as unpublished')
	if (minEdgeBps > maxEdgeBps) throw new Error('the floor cannot exceed the ceiling')

	return ownLeans.map((lean, i) => {
		const contested = contestedBps(lean, crowdingBps[i] as bigint)
		let weight = BPS - (strengthBps * contested) / BPS
		if (weight < 0n) weight = 0n
		const edge = (baseEdgeBps * weight) / BPS
		return edge < minEdgeBps ? minEdgeBps : edge > maxEdgeBps ? maxEdgeBps : edge
	})
}

/**
 * Signed venue lean for one pair, positive when the venue is over-weight tokenA.
 *
 *   crowding = (totalA * mid / 1e18 - totalB) / (totalA * mid / 1e18 + totalB)
 *
 * `mid` is raw tokenB per 1e18 raw tokenA, the same scale the references carry, so no decimals
 * handling appears here any more than it does on-chain.
 *
 * An empty pair returns zero rather than throwing: nothing committed is no evidence about
 * contention, and the allocation treats no evidence as "leave this leg at full budget".
 */
/**
 * The boundary actually published, given the allocated edge.
 *
 * On-chain the boundary caps the whole tilt, and under the reservation policy most of the tilt is
 * the anchor, a correction rather than a concession. Publishing the allocated edge on its own would
 * cap a 4% correction at half a percent and leave the leg to be picked off. So the budget is
 * published as room beyond what is already quoted: the concession may grow by the allocated edge
 * and no further. Never zero, because zero reads as unpublished; never past the ceiling the maker
 * signed, because the instruction only ever lets the boundary tighten that.
 */
export const publishedBoundary = (
	currentTiltBps: bigint,
	allocatedEdgeBps: bigint,
	minEdgeBps: bigint,
	maxEdgeBps: bigint,
): bigint => {
	const magnitude = currentTiltBps < 0n ? -currentTiltBps : currentTiltBps
	const room = magnitude + allocatedEdgeBps
	return room < minEdgeBps ? minEdgeBps : room > maxEdgeBps ? maxEdgeBps : room
}

export const crowdingBpsOf = (totalA: bigint, totalB: bigint, mid: bigint): bigint => {
	if (mid <= 0n) throw new Error('mid must be positive')
	const aInB = (totalA * mid) / ONE
	const denominator = aInB + totalB
	if (denominator === 0n) return 0n
	return ((aInB - totalB) * BPS) / denominator
}
