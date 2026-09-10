/**
 * The cross-chain tilt policy, in integer arithmetic.
 *
 * This is the same policy as the Python reference model and the same clamping as the on-chain
 * ZentisTiltLib. All three have to agree, so everything here is BigInt: no floats, no rounding
 * surprises, and signed division truncates toward zero the way Solidity's does rather than flooring
 * the way a naive implementation would.
 *
 * The policy, stated once:
 *
 *     w_c = A_c / (A_c + B_c * 1e18 / mid_c)      tokenA's share of leg c, valued in raw tokenA
 *     x   = (w_0 - w_1) / 2                        the imbalance BETWEEN the legs, in [-1/2, 1/2]
 *     tilt_0 = kappa * x,  tilt_1 = -kappa * x     anti-symmetric by construction
 *
 * It is the difference between the legs, not each leg's distance from an even split, because a maker
 * whose whole book is 70% tokenA cannot fix that by quoting differently on one chain: every fill that
 * sheds tokenA here adds it there. Tilting only moves inventory between venues, so it should respond
 * only to the part of the imbalance that is between venues.
 */

export const ONE = 10n ** 18n
export const BPS = 10_000n

/** Solidity's `/` for signed integers: truncates toward zero, not floor. */
export const truncDiv = (a: bigint, b: bigint): bigint => {
	const q = (a < 0n ? -a : a) / (b < 0n ? -b : b)
	return a < 0n !== b < 0n ? -q : q
}

const clamp = (v: bigint, lo: bigint, hi: bigint): bigint => (v < lo ? lo : v > hi ? hi : v)

export type Inventory = {
	/** raw tokenA units held by the maker on this leg */
	balanceA: bigint
	/** raw tokenB units */
	balanceB: bigint
	/** raw tokenB per 1e18 raw tokenA, this leg's own reference price */
	mid: bigint
}

export type LegWeight = {
	balanceA: bigint
	balanceB: bigint
	/** tokenB expressed in raw tokenA units */
	bInA: bigint
	totalInA: bigint
	/** 1e18-scaled fraction */
	weightA: bigint
}

export const legWeight = ({ balanceA, balanceB, mid }: Inventory): LegWeight => {
	if (mid <= 0n) throw new Error('mid must be positive')
	const bInA = (balanceB * ONE) / mid
	const totalInA = balanceA + bInA
	if (totalInA === 0n) throw new Error('leg holds no inventory at all')
	return { balanceA, balanceB, bInA, totalInA, weightA: (balanceA * ONE) / totalInA }
}

export type LegPolicy = {
	/** 1e18-scaled imbalance, signed, positive = this leg is the over-weight-tokenA one */
	x: bigint
	tiltBps: bigint
	/** d(tiltBps)/d(raw tokenA), 1e18-scaled — the ZentisRef.dTiltPerA field's units */
	dTiltPerA: bigint
}

/**
 * `kappaBps` is the gain. `x` is half the weight difference, so it lies in [-1/2, 1/2] and a leg
 * holding 100% tokenA against a leg holding 0% tilts `kappaBps / 2`, not the full gain. For the
 * policy to saturate exactly where ZentisSkew clamps, set `kappaBps` to twice `maxTiltBps`; set
 * equal to it, the clamp is unreachable.
 */
export const antiSymmetric = (
	leg0: LegWeight,
	leg1: LegWeight,
	kappaBps: bigint,
	maxTiltBps: bigint,
): [LegPolicy, LegPolicy] => {
	const x = (leg0.weightA - leg1.weightA) / 2n
	const tilt0 = clamp(truncDiv(kappaBps * x, ONE), -maxTiltBps, maxTiltBps)
	return [
		{ x, tiltBps: tilt0, dTiltPerA: slope(leg0, kappaBps) },
		{ x: -x, tiltBps: -tilt0, dTiltPerA: slope(leg1, kappaBps) },
	]
}

/** The policy's own derivative, so ZentisSkew extrapolates under the rule the reference was computed under. */
const slope = (leg: LegWeight, kappaBps: bigint): bigint =>
	(kappaBps * leg.bInA * ONE) / (2n * leg.totalInA * leg.totalInA)

/**
 * mid from a Uniswap v3 `slot0().sqrtPriceX96`, in raw tokenB per 1e18 raw tokenA.
 *
 * price = (sqrtPriceX96 / 2^96)^2 in tokenB-per-tokenA, so mid = sqrtPriceX96^2 * 1e18 / 2^192.
 * Squaring first and dividing once keeps every bit: no decimals handling appears anywhere, on-chain
 * or here, because raw-per-raw already folds both tokens' decimals in.
 */
/**
 * The tilt that reprices a constant-product leg's effective price back onto the mid.
 *
 * The leg's own price is `balanceB / balanceA`, which in weight terms is `(1 - w) / w` of the mid,
 * so in the instruction's sign convention the correction is `(1 - 2w) / w`: negative when the leg
 * holds excess tokenA, because excess tokenA is already cheap on the curve and must be made dear
 * again. Exact for a tokenA-in fill, second-order off for tokenB-in. The caller caps it.
 */
export const anchorTiltBps = (weightA: bigint): bigint =>
	weightA <= 0n ? 0n : truncDiv((ONE - 2n * weightA) * BPS, weightA)

/**
 * The reservation policy. One ref input per leg.
 *
 *     tilt_c = anchor(w_c) + kappaOwn * (w_c - 1/2) + kappaBook * (mean(w) - 1/2)
 *
 * The anchor is a correction: it puts the leg's curve on the mid whatever its reserves say. The two
 * skews are concessions: the leg pays to shed what it holds, and the whole book pays the same way on
 * every leg. Near an even split the anchor is `-4 (w - 1/2)`, so the own-leg gain is a dial from the
 * plain curve (four times the basis) to a curve pinned at the mid (zero).
 *
 * `dTiltPerA` is this policy's own derivative in raw tokenA, so the instruction's extrapolation
 * between references follows the rule the reference was computed under. With `w = A / T` and
 * `T = A + bInA`: `d anchor / dA = -BPS * bInA / A^2` and `d w / dA = bInA / T^2`, and the book term
 * sees a `1/n` share of the leg's own weight change. Mirrors `reference_model.crosschain.reservation`.
 */
export const reservation = (
	legs: LegWeight[],
	kappaOwnBps: bigint,
	kappaBookBps: bigint,
	maxTiltBps: bigint,
	concessionCapsBps?: (bigint | null)[],
): LegPolicy[] => {
	const n = BigInt(legs.length)
	if (n === 0n) throw new Error('a book needs at least one leg')
	const caps = concessionCapsBps ?? legs.map(() => null)
	if (caps.length !== legs.length) throw new Error('one concession cap per leg, or none at all')
	const meanW = legs.reduce((sum, leg) => sum + leg.weightA, 0n) / n
	const half = ONE / 2n
	return legs.map((leg, i) => {
		const w = leg.weightA
		// The bridge-parity budget bounds the two skews together and never the anchor: a correction
		// is not a cost the maker chooses to pay. Null means no budget has been published yet.
		let concession = truncDiv(kappaOwnBps * (w - half), ONE)
		concession += truncDiv(kappaBookBps * (meanW - half), ONE)
		const cap = caps[i] ?? null
		if (cap !== null) {
			if (cap < 0n) throw new Error('a concession budget cannot be negative')
			concession = clamp(concession, -cap, cap)
		}
		let tilt = anchorTiltBps(w) + concession
		tilt = clamp(tilt, -maxTiltBps, maxTiltBps)

		const { balanceA: a, bInA, totalInA: total } = leg
		let slope = 0n
		if (a > 0n) slope += truncDiv(-BPS * bInA * ONE, a * a)
		slope += truncDiv(kappaOwnBps * bInA * ONE, total * total)
		slope += truncDiv(kappaBookBps * bInA * ONE, n * total * total)
		return { x: w - half, tiltBps: tilt, dTiltPerA: slope }
	})
}

export const midFromSqrtPriceX96 = (sqrtPriceX96: bigint): bigint =>
	(sqrtPriceX96 * sqrtPriceX96 * ONE) >> 192n

/** Round to the nearest basis point. The slow workflow buckets its quote so a quiet hour is a no-op. */
export const bucketToBps = (value: bigint, scale: bigint): bigint => {
	const half = scale / (2n * BPS)
	return ((value + half) / (scale / BPS)) * (scale / BPS)
}

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

/**
 * Realised volatility over the reference cadence, from an irregularly sampled price series.
 *
 * The spread has to cover the move the price makes between two references, because that is how far
 * a quote can be stale before it is repriced. So the horizon is the cadence, and the term is the
 * standard deviation of the mid over that horizon, in basis points.
 *
 * Samples arrive whenever the reference pool trades, not on a clock. The estimator that handles
 * that is the sum of squared returns over the total elapsed time, the variance rate per second
 * under Brownian scaling; times the horizon, rooted, is sigma over the horizon. Two swaps in the
 * same second are one observation and the later one stands. Rounded to the nearest basis point at
 * the very end, so a quiet hour republishes the same value. Mirrors `reference_model.volatility`.
 */

export type PriceSample = { timestamp: bigint; mid: bigint }

/** Floor of the square root, by Newton's method, matching the model's integer routine exactly. */
export const isqrt = (n: bigint): bigint => {
	if (n < 0n) throw new Error('no real root')
	if (n < 2n) return n
	let x = n
	let y = (x + 1n) / 2n
	while (y < x) {
		x = y
		y = (x + n / x) / 2n
	}
	return x
}

/** `[sum of squared 1e18-scaled returns, elapsed seconds]` over an ascending series. */
export const realisedVarianceRate = (samples: PriceSample[]): [bigint, bigint] => {
	const kept: PriceSample[] = []
	for (const s of samples) {
		if (s.mid <= 0n) throw new Error('mid must be positive')
		const last = kept[kept.length - 1]
		if (last && s.timestamp < last.timestamp) throw new Error('samples must be in ascending time order')
		if (last && s.timestamp === last.timestamp) kept[kept.length - 1] = s
		else kept.push(s)
	}
	if (kept.length < 2) return [0n, 0n]

	let sumSq = 0n
	for (let i = 1; i < kept.length; i++) {
		const prev = (kept[i - 1] as PriceSample).mid
		const cur = (kept[i] as PriceSample).mid
		const r = cur >= prev ? ((cur - prev) * ONE) / prev : -(((prev - cur) * ONE) / prev)
		sumSq += r * r
	}
	return [sumSq, (kept[kept.length - 1] as PriceSample).timestamp - (kept[0] as PriceSample).timestamp]
}

export const sigmaOverHorizonBps = (samples: PriceSample[], horizonSeconds: bigint): bigint => {
	const [sumSq, elapsed] = realisedVarianceRate(samples)
	if (elapsed === 0n) return 0n
	const sigma = isqrt((horizonSeconds * sumSq) / elapsed) // 1e18-scaled
	return (sigma * BPS + ONE / 2n) / ONE // nearest basis point
}

/**
 * The term the spread carries: `multiplier * sigma_H`, floored at zero, capped. Capped because the
 * spread instruction reverts the whole swap when its terms sum past the full basis, so an unbounded
 * term would not widen a leg, it would brick it.
 */
export const volatilitySpreadBps = (
	samples: PriceSample[],
	horizonSeconds: bigint,
	multiplierBps: bigint,
	capBps: bigint,
): bigint => {
	if (capBps < 0n || multiplierBps < 0n) throw new Error('neither the cap nor the multiplier may be negative')
	const term = (multiplierBps * sigmaOverHorizonBps(samples, horizonSeconds)) / BPS
	return term > capBps ? capBps : term
}
