"""Pure reference model for the tilt/ramp arithmetic in contracts/src/libs/ZentisTiltLib.sol.

Mirrors the Solidity exactly, including its int256 truncate-toward-zero division, so fixture
vectors generated here are byte-for-byte comparable to the on-chain result.
"""

BPS = 10_000
ONE_E18 = 10**18


def trunc_div(a: int, b: int) -> int:
    """Solidity's `/` for signed integers: truncates toward zero, not floor."""
    q = abs(a) // abs(b)
    return -q if (a < 0) != (b < 0) else q


def effective_tilt(
    tilt_bps: int,
    ref_balance_a: int,
    d_tilt_per_a: int,
    max_extrap_bps: int,
    live_balance_a: int,
    max_tilt_bps: int,
) -> int:
    delta = live_balance_a - ref_balance_a
    adj = trunc_div(delta * d_tilt_per_a, ONE_E18)
    cap = max_extrap_bps
    if adj > cap:
        adj = cap
    if adj < -cap:
        adj = -cap

    tilt = tilt_bps + adj
    hard = max_tilt_bps
    if tilt > hard:
        tilt = hard
    if tilt < -hard:
        tilt = -hard
    return tilt


def soft_bound_widen_bps(live_balance_out: int, floor: int, max_widen_bps: int) -> int:
    if floor == 0 or live_balance_out >= floor * 2:
        return 0
    if live_balance_out <= floor:
        return max_widen_bps
    room = live_balance_out - floor
    return max_widen_bps - (max_widen_bps * room) // floor
