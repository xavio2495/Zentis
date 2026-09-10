"""The cross-chain tilt policy: two legs' live inventories in, one anti-symmetric pair of refs out.

`fetch_live_mid.x` was a placeholder computed off the *pool's* composition, because no Zentis
position existed yet. This module is its replacement: the imbalance that matters is the maker's own,
and it is a property of the pair of legs, not of either one alone.

The policy, stated once:

    Value each leg's inventory in raw tokenA units, using that leg's own mid.
        w_c = A_c / (A_c + B_c * 1e18 / mid_c)                     tokenA's share of leg c
    The signal is the DIFFERENCE between the legs, not either leg's distance from an even split:
        x   = (w_0 - w_1) / 2                                       in [-1/2, 1/2]
        tilt_0 = kappa * x,   tilt_1 = -kappa * x
    so the two refs are anti-symmetric by construction, and two legs saturate at kappa / 2: a gain
equal to the clamp never reaches it. With n legs the extreme is kappa * (n - 1) / n.

Why the difference and not `w_c - 1/2`: a maker whose total book is 70% tokenA cannot fix that by
quoting differently on one chain — every fill that sheds tokenA here adds it there. Tilting can only
move inventory *between* venues, so it should respond only to the part of the imbalance that is
between venues. Under `w_0 - 1/2` both legs would tilt the same way and quote against each other.

`dTiltPerA` is this policy's own derivative, so ZentisSkew's extrapolation between reference updates
follows the same rule the reference was computed under:

    d(tilt_c)/dA_c = (kappa / 2) * (B_c in A units) / (A_c + B_c in A units)^2

positive on both legs: tokenA accumulating locally means locally over-weight A, which discounts A.
"""

from reference_model.tilt import trunc_div

BPS = 10_000
ONE_E18 = 10**18


def value_in_a(balance_b: int, mid: int) -> int:
    """tokenB expressed in raw tokenA units. `mid` is raw tokenB per 1e18 raw tokenA."""
    if mid <= 0:
        raise ValueError("mid must be positive")
    return balance_b * ONE_E18 // mid


def leg_weight(balance_a: int, balance_b: int, mid: int) -> dict:
    b_in_a = value_in_a(balance_b, mid)
    total = balance_a + b_in_a
    if total == 0:
        raise ValueError("leg holds no inventory at all")
    return {
        "balanceA": balance_a,
        "balanceB": balance_b,
        "bInA": b_in_a,
        "totalInA": total,
        "weightA": balance_a * ONE_E18 // total,  # 1e18-scaled fraction
    }


def cross_leg_imbalance(legs: list[dict]) -> list[int]:
    """Each leg's deviation from the book's average weight, 1e18-scaled, summing to ~zero.

        x_i = w_i - mean(w)

    Written over a common numerator, `(n*w_i - Sum(w)) / n`, so that at n = 2 it reduces to
    `(w_0 - w_1) / 2` exactly — same numerator, same divisor, same rounding — and the two-leg
    behaviour this policy shipped with is preserved bit for bit rather than approximately.
    """
    n = len(legs)
    if n < 2:
        raise ValueError("an imbalance needs at least two legs")
    total = sum(leg["weightA"] for leg in legs)
    return [trunc_div(n * leg["weightA"] - total, n) for leg in legs]


def anti_symmetric(leg0: dict, leg1: dict, kappa_bps: int, max_tilt_bps: int) -> tuple[dict, dict]:
    """`leg0`/`leg1` are `leg_weight` results. Returns (ref inputs for leg0, for leg1)."""
    # Truncating division, not Python's floor: the on-chain library and the TypeScript in the
    # workflow both truncate toward zero, and floor division disagreed with them whenever this
    # numerator was negative and odd.
    x = trunc_div(leg0["weightA"] - leg1["weightA"], 2)  # 1e18-scaled, in [-0.5e18, 0.5e18]

    tilt0 = trunc_div(kappa_bps * x, ONE_E18)
    tilt0 = max(-max_tilt_bps, min(max_tilt_bps, tilt0))

    return (
        {"x": x, "tiltBps": tilt0, "dTiltPerA": _slope(leg0, kappa_bps)},
        {"x": -x, "tiltBps": -tilt0, "dTiltPerA": _slope(leg1, kappa_bps)},
    )


def distribute(legs: list[dict], kappa_bps: int, max_tilt_bps: int) -> list[dict]:
    """The N-leg policy. At two legs it returns exactly what `anti_symmetric` does.

    Each leg is tilted by its own deviation from the book's average weight, so the tilts sum to zero
    up to integer rounding — which is conservation restated: inventory tilted off one leg has to be
    tilted onto the others, because tilting cannot create or destroy any.
    """
    xs = cross_leg_imbalance(legs)
    out = []
    for x, leg in zip(xs, legs):
        tilt = trunc_div(kappa_bps * x, ONE_E18)
        tilt = max(-max_tilt_bps, min(max_tilt_bps, tilt))
        out.append({"x": x, "tiltBps": tilt, "dTiltPerA": _slope(leg, kappa_bps)})
    return out


def _slope(leg: dict, kappa_bps: int) -> int:
    """d(tiltBps)/d(raw tokenA), 1e18-scaled — the `dTiltPerA` field's units."""
    return (kappa_bps * leg["bInA"] * ONE_E18) // (2 * leg["totalInA"] ** 2)


def anchor_tilt_bps(weight_a: int) -> int:
    """The tilt that reprices a constant-product leg's effective price back onto the mid.

    The leg's own price is `balanceB / balanceA`, which in weight terms is `(1 - w) / w` of the mid,
    so in the instruction's sign convention the correction is `(1 - 2w) / w`: negative when the leg
    holds excess tokenA, because excess tokenA is already cheap on the curve and must be made dear
    again. Exact for a tokenA-in fill, second-order off for tokenB-in. The caller caps it.
    """
    if weight_a <= 0:
        return 0
    return trunc_div((ONE_E18 - 2 * weight_a) * BPS, weight_a)


def reservation(legs: list[dict], kappa_own_bps: int, kappa_book_bps: int, max_tilt_bps: int) -> list[dict]:
    """The reservation policy. `legs` are `leg_weight` results; one ref input per leg comes back.

        tilt_c = anchor(w_c) + kappa_own * (w_c - 1/2) + kappa_book * (mean(w) - 1/2)

    The anchor is a correction: it puts the leg's curve on the mid whatever its reserves say. The
    two skews are concessions: the leg pays to shed what it holds, and the whole book pays the same
    way on every leg. Near an even split the anchor is `-4 (w - 1/2)`, so the own-leg gain is a dial
    from the plain curve (four times the basis) to a curve pinned at the mid (zero).

    `dTiltPerA` is this policy's own derivative in raw tokenA, so the instruction's extrapolation
    between references follows the rule the reference was computed under. With `w = A / T` and
    `T = A + B_in_A`:

        d anchor / dA  = -BPS * B_in_A / A^2
        d w / dA       =  B_in_A / T^2

    and the book term sees a 1/n share of the leg's own weight change.
    """
    n = len(legs)
    if n == 0:
        raise ValueError("a book needs at least one leg")
    ws = [leg["weightA"] for leg in legs]
    mean_w = sum(ws) // n
    half = ONE_E18 // 2
    out = []
    for leg, w in zip(legs, ws):
        tilt = anchor_tilt_bps(w)
        tilt += trunc_div(kappa_own_bps * (w - half), ONE_E18)
        tilt += trunc_div(kappa_book_bps * (mean_w - half), ONE_E18)
        tilt = max(-max_tilt_bps, min(max_tilt_bps, tilt))

        a, b_in_a, total = leg["balanceA"], leg["bInA"], leg["totalInA"]
        slope = 0
        if a > 0:
            slope += trunc_div(-BPS * b_in_a * ONE_E18, a * a)
        slope += trunc_div(kappa_own_bps * b_in_a * ONE_E18, total * total)
        slope += trunc_div(kappa_book_bps * b_in_a * ONE_E18, n * total * total)
        out.append({"x": w - half, "tiltBps": tilt, "dTiltPerA": slope})
    return out
