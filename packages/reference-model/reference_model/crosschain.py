"""The cross-chain tilt policy: two legs' live inventories in, one anti-symmetric pair of refs out.

`fetch_live_mid.x` was a placeholder computed off the *pool's* composition, because no Zentis
position existed yet. This module is its replacement: the imbalance that matters is the maker's own,
and it is a property of the pair of legs, not of either one alone.

The policy, stated once:

    Value each leg's inventory in raw tokenA units, using that leg's own mid.
        w_c = A_c / (A_c + B_c * 1e18 / mid_c)                     tokenA's share of leg c
    The signal is the DIFFERENCE between the legs, not either leg's distance from an even split:
        x   = (w_0 - w_1) / 2                                       in [-1, 1]
        tilt_0 = kappa * x,   tilt_1 = -kappa * x
    so the two refs are anti-symmetric by construction.

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
    x = trunc_div(leg0["weightA"] - leg1["weightA"], 2)  # 1e18-scaled, in [-1e18, 1e18]

    tilt0 = trunc_div(kappa_bps * x, ONE_E18)
    tilt0 = max(-max_tilt_bps, min(max_tilt_bps, tilt0))

    return (
        {"x": x, "tiltBps": tilt0, "dTiltPerA": _slope(leg0, kappa_bps)},
        {"x": -x, "tiltBps": -tilt0, "dTiltPerA": _slope(leg1, kappa_bps)},
    )


def _slope(leg: dict, kappa_bps: int) -> int:
    """d(tiltBps)/d(raw tokenA), 1e18-scaled — the `dTiltPerA` field's units."""
    return (kappa_bps * leg["bInA"] * ONE_E18) // (2 * leg["totalInA"] ** 2)
