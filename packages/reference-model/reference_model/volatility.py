"""Realised volatility over the reference cadence, from an irregularly sampled price series.

The spread has to cover the move the price makes between two references, because that is how far
a quote can be stale before it is repriced. So the horizon is the cadence, and the term is the
standard deviation of the mid over that horizon, in basis points.

Samples arrive whenever the reference pool trades, not on a clock. The estimator that handles that
is the sum of squared returns over the total elapsed time, which is the variance rate per second
under Brownian scaling; multiplying by the horizon and taking the root gives sigma over the horizon:

    r_i        = (mid_i - mid_{i-1}) * 1e18 / mid_{i-1}       truncating, 1e18-scaled
    rate       = sum(r_i^2) / sum(dt_i)                        per second
    sigma_H    = isqrt(H * sum(r_i^2) / sum(dt_i))             1e18-scaled, over the horizon

and the result is rounded to the nearest basis point at the very end, so a steady 30 bps a minute
reads as 30 and not 29, and a quiet hour republishes the same value.

Two swaps in the same second are one observation, and the later one stands: a zero interval is not
a move, and dividing by it would say the price moved infinitely fast.

Everything is integer arithmetic so the TypeScript in the workflow can agree bit for bit.
"""

BPS = 10_000
ONE = 10**18


def isqrt(n: int) -> int:
    """Floor of the square root, by Newton's method, so the workflow can mirror it on bigints."""
    if n < 0:
        raise ValueError("no real root")
    if n < 2:
        return n
    x = n
    y = (x + 1) // 2
    while y < x:
        x = y
        y = (x + n // x) // 2
    return x


def realised_variance_rate(samples: list[tuple[int, int]]) -> tuple[int, int]:
    """`(sum of squared 1e18-scaled returns, elapsed seconds)` over an ascending `(timestamp, mid)` series.

    Returned as a pair rather than a quotient so the caller can scale before dividing.
    """
    kept: list[tuple[int, int]] = []
    for t, mid in samples:
        if mid <= 0:
            raise ValueError("mid must be positive")
        if kept and t < kept[-1][0]:
            raise ValueError("samples must be in ascending time order")
        if kept and t == kept[-1][0]:
            kept[-1] = (t, mid)
        else:
            kept.append((t, mid))
    if len(kept) < 2:
        return 0, 0

    sum_sq = 0
    for (_, prev), (_, cur) in zip(kept, kept[1:]):
        r = (cur - prev) * ONE // prev if cur >= prev else -((prev - cur) * ONE // prev)
        sum_sq += r * r
    return sum_sq, kept[-1][0] - kept[0][0]


def sigma_over_horizon_bps(samples: list[tuple[int, int]], horizon_seconds: int) -> int:
    sum_sq, elapsed = realised_variance_rate(samples)
    if elapsed == 0:
        return 0
    sigma = isqrt(horizon_seconds * sum_sq // elapsed)  # 1e18-scaled
    return (sigma * BPS + ONE // 2) // ONE  # nearest basis point


def volatility_spread_bps(
    samples: list[tuple[int, int]], horizon_seconds: int, multiplier_bps: int, cap_bps: int
) -> int:
    """The term the spread carries: `multiplier * sigma_H`, floored at zero, capped.

    Capped because the spread instruction reverts the whole swap when its terms sum past the full
    basis, so an unbounded term would not widen a leg, it would brick it.
    """
    if cap_bps < 0 or multiplier_bps < 0:
        raise ValueError("neither the cap nor the multiplier may be negative")
    term = multiplier_bps * sigma_over_horizon_bps(samples, horizon_seconds) // BPS
    return min(term, cap_bps)
