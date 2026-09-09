"""Crowding-weighted allocation of the rebalancing budget across legs.

The budget is `bandEdgeBps`: the impulse boundary, priced from what it actually costs to move
inventory between chains. On-chain it can only ever *tighten* the cap the maker signed, so
allocating it means deciding, per leg, how much concession the maker is willing to bid.

The decision the allocation makes is not "how much am I out of balance" — that is the tilt's job —
but "where should I bid for the correction". Those differ whenever the rest of the venue leans the
way we do:

    Our leg is over-weight tokenA, so we want takers to take tokenA out of it. If every other maker
    on that venue is also over-weight tokenA, we are all bidding for the same corrective takers and
    our concession has to beat theirs. That leg is contested; the correction is cheaper elsewhere.

So a leg is throttled exactly when our own lean and the venue's lean point the same way. A leg the
venue leans *against* is left at full budget: there we are the natural counterparty and the flow
arrives without paying up for it.

    contested_i = |crowding_i|  when sign(x_i) == sign(crowding_i), else 0
    weight_i    = 1 - strength * contested_i
    edge_i      = clamp(baseEdge * weight_i, minEdge, maxEdge)

`strength` is the maker's own aggression and never leaves the enclave. `crowding` is computed from
public Aqua events and is deliberately not secret.

At one leg, or with no crowding data anywhere, every weight is 1 and the allocation returns the base
edge unchanged on every leg — the behaviour the system had before this existed.
"""

BPS = 10_000


def _sign(value: int) -> int:
    return 0 if value == 0 else (1 if value > 0 else -1)


def contested_bps(own_lean: int, crowding_bps: int) -> int:
    """How much of the venue's lean is working against us on this leg, in bps.

    Zero when the signs differ, because a venue leaning the other way is not competition — it is the
    counterparty. Zero when either side is flat, because neither is evidence of contention.
    """
    if _sign(own_lean) == 0 or _sign(crowding_bps) == 0:
        return 0
    if _sign(own_lean) != _sign(crowding_bps):
        return 0
    return abs(crowding_bps)


def allocate_band_edge(
    base_edge_bps: int,
    own_leans: list[int],
    crowding_bps: list[int],
    strength_bps: int,
    min_edge_bps: int,
    max_edge_bps: int,
) -> list[int]:
    """One budget per leg. Deterministic, integer-only, order-independent."""
    if len(own_leans) != len(crowding_bps):
        raise ValueError("every leg needs both its own lean and its venue's")
    if base_edge_bps < 0 or strength_bps < 0:
        raise ValueError("neither the budget nor the aggression may be negative")
    if min_edge_bps < 1:
        # Zero means "nothing has been published" to the instruction, so an allocation must never
        # produce it: a throttled leg would silently become an unbounded one.
        raise ValueError("the floor must be at least 1, because 0 reads as unpublished")
    if min_edge_bps > max_edge_bps:
        raise ValueError("the floor cannot exceed the ceiling")

    out = []
    for lean, crowd in zip(own_leans, crowding_bps):
        contested = contested_bps(lean, crowd)
        weight = BPS - (strength_bps * contested) // BPS
        if weight < 0:
            weight = 0
        edge = (base_edge_bps * weight) // BPS
        out.append(max(min_edge_bps, min(max_edge_bps, edge)))
    return out
