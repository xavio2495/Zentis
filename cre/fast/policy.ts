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
): LegPolicy[] => {
	const n = BigInt(legs.length)
	if (n === 0n) throw new Error('a book needs at least one leg')
	const meanW = legs.reduce((sum, leg) => sum + leg.weightA, 0n) / n
	const half = ONE / 2n
	return legs.map((leg) => {
		const w = leg.weightA
		let tilt = anchorTiltBps(w)
		tilt += truncDiv(kappaOwnBps * (w - half), ONE)
		tilt += truncDiv(kappaBookBps * (meanW - half), ONE)
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
