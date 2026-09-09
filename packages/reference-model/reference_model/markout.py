"""Adverse-selection markout, measured off indexed fills.

A maker loses to adverse selection when the takers who trade with it are, on average, right about
where the price is going. Markout measures that directly: take the price a fill actually executed
at, compare it to the reference some fixed time later, and sign it from the maker's side.

    price      = raw tokenB per 1e18 raw tokenA, the same scale as `mid`
    AtoB       taker sold tokenA, so the MAKER BOUGHT tokenA at `price`
    BtoA       taker bought tokenA, so the MAKER SOLD tokenA at `price`

    markout    = +(mid_after - price) / mid_after   when the maker bought
                 -(mid_after - price) / mid_after   when the maker sold

Positive means the maker was on the right side. Negative is adverse selection, and its magnitude is
what the half-spread has to widen by for the flow to break even.

Two deliberate asymmetries:

  * Only matured fills count. A fill needs a reference published at or after `t + horizon` before it
    has a markout at all; an unmatured fill is excluded rather than measured against a stale mid.
  * A favourable markout never narrows the spread. The published term is floored at zero. Widening
    when flow has been costly is risk management; narrowing when flow has been kind is paying takers
    for having been wrong, which is not a thing a maker should do.

Everything is integer arithmetic so the TypeScript in the workflow can agree bit for bit.
"""

ONE = 10**18
BPS = 10_000


def _trunc_div(a: int, b: int) -> int:
    """Solidity's `/` for signed integers: truncates toward zero, not floor."""
    q = abs(a) // abs(b)
    return -q if (a < 0) != (b < 0) else q


def fill_price(is_a_to_b: bool, amount_in: int, amount_out: int) -> int:
    """The price this fill executed at, in raw tokenB per 1e18 raw tokenA.

    On an AtoB fill the taker supplies `amount_in` tokenA and receives `amount_out` tokenB, so the
    maker paid `amount_out` tokenB for `amount_in` tokenA. On BtoA it is the other way round.
    """
    if amount_in <= 0 or amount_out <= 0:
        raise ValueError("a fill with a zero leg has no price")
    if is_a_to_b:
        return amount_out * ONE // amount_in
    return amount_in * ONE // amount_out


def fill_size_in_a(is_a_to_b: bool, amount_in: int, amount_out: int) -> int:
    """The fill's size in raw tokenA, which is the side both directions have in common."""
    return amount_in if is_a_to_b else amount_out


def mid_after(references: list[dict], at_or_after: int) -> int | None:
    """The first published mid at or after a timestamp, or None if the fill has not matured.

    `references` is the position's own reference series, each entry carrying `updatedAt` (the
    timestamp of the block the workflow queried, not of the write) and `mid`.
    """
    best = None
    for ref in references:
        stamp = int(ref["updatedAt"])
        if stamp < at_or_after:
            continue
        if best is None or stamp < int(best["updatedAt"]):
            best = ref
    return None if best is None else int(best["mid"])


def fill_markout_bps(is_a_to_b: bool, price: int, later_mid: int) -> int:
    """Signed markout for one fill, in basis points, from the maker's side."""
    if later_mid <= 0:
        raise ValueError("mid must be positive")
    raw = _trunc_div((later_mid - price) * BPS, later_mid)
    return raw if is_a_to_b else -raw


class Markout:
    """The measurement, kept whole so a dry run can show its working."""

    def __init__(self, matured: int, skipped: int, weighted_bps: int, published_bps: int):
        self.matured = matured
        self.skipped = skipped
        self.weighted_bps = weighted_bps
        self.published_bps = published_bps

    def __repr__(self) -> str:
        return (
            f"Markout(matured={self.matured}, skipped={self.skipped}, "
            f"weighted_bps={self.weighted_bps}, published_bps={self.published_bps})"
        )


def markout_bps(
    fills: list[dict],
    references: list[dict],
    horizon_seconds: int,
    cap_bps: int,
) -> Markout:
    """Size-weighted markout over a leg's fills, reduced to the term the spread instruction adds.

    Weighting is by size in raw tokenA, so one large fill is not outvoted by a handful of dust ones.
    The result is negated and floored at zero, then capped: the instruction reverts the whole swap if
    the base spread, this term and the soft-bound widen sum past the full basis, so an unbounded
    markout would not widen a leg, it would brick it.
    """
    if cap_bps < 0:
        raise ValueError("cap must not be negative")

    weighted_sum = 0
    total_weight = 0
    matured = 0
    skipped = 0

    for fill in fills:
        is_a_to_b = bool(fill["isAToB"])
        amount_in = int(fill["amountIn"])
        amount_out = int(fill["amountOut"])
        later = mid_after(references, int(fill["timestamp"]) + horizon_seconds)
        if later is None:
            skipped += 1
            continue

        price = fill_price(is_a_to_b, amount_in, amount_out)
        size = fill_size_in_a(is_a_to_b, amount_in, amount_out)
        weighted_sum += fill_markout_bps(is_a_to_b, price, later) * size
        total_weight += size
        matured += 1

    weighted = 0 if total_weight == 0 else _trunc_div(weighted_sum, total_weight)
    published = min(max(-weighted, 0), cap_bps)
    return Markout(matured, skipped, weighted, published)
