"""The three-policy simulation: does pricing inventory actually beat not pricing it?

One model, two purposes. The policies here are not a re-implementation of what the contracts do —
they call the same `leg_weight` and `distribute` the workflow and the on-chain reference use, so a
change to the policy shows up in the simulation rather than quietly diverging from it.

The three series, named for what they actually are:

  static    no tilt at all. Plain constant product on each leg, quoting the same curve whatever the
            inventory looks like. The control.
  linear    tilt proportional to the imbalance, unbounded, and no transfers. This is the textbook
            inventory-skew market maker.
  zentis    the same tilt, clamped at `max_tilt_bps`, plus the band: fills that would push the curve
            further than `band_tol_bps` from the reference are refused, and when the boundary binds
            the maker moves inventory itself and pays for it.

The tilt is convex in raw inventory even though it is linear in the weight, because a leg's weight
`A / (A + B/mid)` is itself nonlinear in `A`. That convexity is a property of the shipped policy,
not something added here for the simulation.

Everything is seeded and every parameter is declared in `Series` and `Book`, so a run is
reproducible and the assumptions are readable next to the results rather than buried.
"""

import random
from dataclasses import dataclass, field

from reference_model.crosschain import distribute, leg_weight

BPS = 10_000
ONE_E18 = 10**18


@dataclass(frozen=True)
class Series:
    """The price path. Disclosed rather than tuned: these numbers belong beside the results."""

    ticks: int = 2_000
    #: total drift across the whole run, in bps — a mild trend, not a crash
    trend_bps: int = 300
    #: per-tick volatility, in bps
    vol_bps: int = 25
    seed: int = 1


@dataclass(frozen=True)
class Book:
    """The maker's book and the flow it faces."""

    legs: int = 2
    #: opening tokenA per leg, raw units (6dp token)
    balance_a: int = 15_000_000
    #: fraction of a leg's inventory a single taker takes
    fill_fraction_bps: int = 100
    #: chance a taker arrives on any given tick
    arrival_bps: int = 2_000
    #: depth of the external venue a taker on the first leg could use instead, in raw tokenA.
    #: A taker does not compare the maker to a perfect mid — they compare it to the best price they
    #: can actually get on the chain they are standing on, which has finite depth and therefore its
    #: own slippage. Pinning acceptance to the mid instead makes the maker's curve track the mid
    #: exactly, so no inventory imbalance can ever build and every policy looks identical.
    external_depth_a: int = 200_000_000
    #: the other legs' external venues are deeper by this multiple, so the first leg is the thin
    #: chain where the maker wins flow while drifting further from the mid.
    external_depth_multiple: int = 10
    #: share of flow that arrives as tokenA-in, in bps. 5000 is balanced; above it the maker faces
    #: persistent one-sided flow, which is the case inventory pricing exists for. A maker facing
    #: balanced flow does not need a tilt and the simulation would show none of them differing.
    flow_a_to_b_bps: int = 6_500
    #: share of arrivals that land on the first leg, in bps. Takers are chain-local, so uneven flow
    #: across chains is what drives the legs apart — and driving them apart is the only thing a
    #: cross-chain tilt can answer. Even flow needs no tilt and the policies would not differ.
    flow_first_leg_bps: int = 7_000
    #: maker's half-spread, matching the shipped `spreadBps`
    spread_bps: int = 10
    kappa_bps: int = 500
    max_tilt_bps: int = 500
    #: the band's tolerance around the reference, matching `BAND_TOL_BPS`
    band_tol_bps: int = 500
    #: what it costs the maker to move inventory between legs itself
    transfer_cost_bps: int = 54


@dataclass
class Leg:
    balance_a: int
    balance_b: int
    mid: int


@dataclass
class Result:
    name: str
    pnl_a: int = 0
    fills: int = 0
    refused: int = 0
    #: arrivals that looked at the price and walked away
    declined: int = 0
    transfers: int = 0
    transfer_cost_a: int = 0
    ticks: list = field(default_factory=list)


def price_path(series: Series) -> list[float]:
    """A seeded random walk with drift, as a multiplier on the opening mid."""
    rng = random.Random(series.seed)
    drift = (series.trend_bps / BPS) / series.ticks
    level = 1.0
    out = [level]
    for _ in range(series.ticks):
        shock = rng.gauss(0.0, series.vol_bps / BPS)
        level *= 1.0 + drift + shock
        out.append(level)
    return out


def _tilts(legs: list[Leg], book: Book, bounded: bool) -> list[int]:
    weights = [leg_weight(leg.balance_a, leg.balance_b, leg.mid) for leg in legs]
    cap = book.max_tilt_bps if bounded else BPS  # unbounded means "no clamp that ever binds"
    return [p["tiltBps"] for p in distribute(weights, book.kappa_bps, cap)]


def _quote(leg: Leg, tilt_bps: int, a_to_b: bool, amount_in: int, book: Book) -> int:
    """Constant product with the tilt applied to `balanceIn`, exactly as the skew instruction does."""
    balance_in = leg.balance_a if a_to_b else leg.balance_b
    balance_out = leg.balance_b if a_to_b else leg.balance_a
    if balance_in <= 0 or balance_out <= 0:
        return 0

    # tilt > 0 means over-weight tokenA here, so tokenA is made cheap: a taker bringing tokenA in
    # gets less out, and a taker taking tokenA out gets more.
    out_is_token_a = not a_to_b
    discount = (tilt_bps > 0) == out_is_token_a
    magnitude = abs(tilt_bps)
    adjusted_in = balance_in * (BPS - magnitude if discount else BPS + magnitude) // BPS

    net_in = amount_in * (BPS - book.spread_bps) // BPS
    if adjusted_in + net_in == 0:
        return 0
    return net_in * balance_out // (adjusted_in + net_in)


def _external_out(leg: Leg, a_to_b: bool, amount_in: int, depth_a: int) -> int:
    """What the taker would get from the external venue on their own chain.

    A constant-product pool holding `depth_a` tokenA at this leg's mid. It is the taker's real
    alternative, so it is what the maker has to beat — and its finite depth is what lets the maker
    win flow while sitting away from the mid, which is how an inventory imbalance builds at all.
    """
    depth_b = depth_a * leg.mid // ONE_E18
    if a_to_b:
        return amount_in * depth_b // (depth_a + amount_in)
    return amount_in * depth_a // (depth_b + amount_in)


def _value_in_a(leg: Leg) -> int:
    return leg.balance_a + leg.balance_b * ONE_E18 // leg.mid


def run(name: str, series: Series, book: Book, *, tilted: bool, bounded: bool, banded: bool) -> Result:
    """One policy over one price path. `tilted=False` is the static control."""
    rng = random.Random(series.seed + 1)
    path = price_path(series)

    base_mid = 275_818_853_000_085_890_554_200_491
    legs = [
        Leg(book.balance_a, book.balance_a * base_mid // ONE_E18, base_mid)
        for _ in range(book.legs)
    ]
    opening = sum(_value_in_a(leg) for leg in legs)
    result = Result(name=name)

    for tick in range(series.ticks):
        for index, leg in enumerate(legs):
            # Each leg sees the same path, offset so the legs are not perfectly synchronised.
            leg.mid = int(base_mid * path[tick] * (1.0 + 0.001 * index))

        tilts = _tilts(legs, book, bounded) if tilted else [0] * len(legs)

        if rng.randrange(BPS) < book.arrival_bps:
            a_to_b = rng.randrange(BPS) < book.flow_a_to_b_bps
            # Where the taker is standing. They can only trade the leg they are on: there is no
            # bridging in this design, which is the whole reason a cross-leg tilt has to exist.
            index = (
                0
                if len(legs) == 1 or rng.randrange(BPS) < book.flow_first_leg_bps
                else rng.randrange(1, len(legs))
            )
            leg, tilt = legs[index], tilts[index]

            size_base = leg.balance_a if a_to_b else leg.balance_b
            amount_in = max(1, size_base * book.fill_fraction_bps // BPS)
            got = _quote(leg, tilt, a_to_b, amount_in, book)

            # A taker only trades if the maker beats their alternative. That is the channel the
            # tilt acts through: a discount wins flow that would otherwise have gone elsewhere, and
            # a premium hands it back.
            depth = book.external_depth_a * (1 if index == 0 else book.external_depth_multiple)
            floor = _external_out(leg, a_to_b, amount_in, depth)
            if got > 0 and got >= floor:
                if banded and abs(tilt) >= book.band_tol_bps:
                    result.refused += 1
                else:
                    if a_to_b:
                        leg.balance_a += amount_in
                        leg.balance_b -= got
                    else:
                        leg.balance_b += amount_in
                        leg.balance_a -= got
                    result.fills += 1
            else:
                result.declined += 1

        # The impulse: when the tilt has run to its cap, pricing has stopped working and the maker
        # moves inventory itself, paying the transfer cost.
        if banded:
            for i, tilt in enumerate(_tilts(legs, book, bounded)):
                if abs(tilt) >= book.max_tilt_bps and len(legs) > 1:
                    other = legs[(i + 1) % len(legs)]
                    move = abs(legs[i].balance_a - other.balance_a) // 4
                    if move > 0:
                        cost = move * book.transfer_cost_bps // BPS
                        if legs[i].balance_a > other.balance_a:
                            legs[i].balance_a -= move
                            other.balance_a += move - cost
                        else:
                            other.balance_a -= move
                            legs[i].balance_a += move - cost
                        result.transfers += 1
                        result.transfer_cost_a += cost

        result.ticks.append(
            {
                "tick": tick,
                "mid": legs[0].mid,
                "inventory": sum(_value_in_a(leg) for leg in legs),
                "fills": result.fills,
                "refused": result.refused,
                "transfers": result.transfers,
                "tilts": list(tilts),
                "weights": [
                    leg_weight(l.balance_a, l.balance_b, l.mid)["weightA"] for l in legs
                ],
            }
        )

    closing = sum(_value_in_a(leg) for leg in legs)
    result.pnl_a = closing - opening
    return result
