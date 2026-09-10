"""The harness has to model the instructions it claims to mirror, and report a number that means
something. These pin both."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.simulate import (  # noqa: E402
    BPS,
    ONE_E18,
    Book,
    Leg,
    Series,
    anchor_tilt_bps,
    band_allows,
    run,
)

MID = 275_818_853_000_085_890_554_200_491


def _leg(mispricing_bps: int) -> Leg:
    """A constant-product leg whose own price sits `mispricing_bps` below the mid."""
    a = 15_000_000
    b = a * MID // ONE_E18 * (BPS - mispricing_bps) // BPS
    return Leg(a, b, MID)


def _fill(leg: Leg, a_to_b: bool, book: Book) -> tuple[int, int]:
    from reference_model.simulate import _quote

    amount_in = (leg.balance_a if a_to_b else leg.balance_b) * book.fill_fraction_bps // BPS
    return amount_in, _quote(leg, 0, a_to_b, amount_in, book)


class TestBandMirrorsTheInstruction:
    """ZentisBand compares the realised price to the reference mid, within spread + |tilt| + tol.
    It does not look at the tilt's magnitude on its own."""

    def test_refuses_a_sale_of_token_a_priced_far_below_the_mid(self):
        book = Book()
        leg = _leg(1_000)  # 10% below mid, well past the 5% tolerance
        amount_in, got = _fill(leg, a_to_b=False, book=book)
        assert not band_allows(leg.mid, 0, book, a_to_b=False, amount_in=amount_in, amount_out=got)

    def test_accepts_the_same_pool_when_the_maker_is_buying_token_a_cheap(self):
        book = Book()
        leg = _leg(1_000)
        amount_in, got = _fill(leg, a_to_b=True, book=book)
        assert band_allows(leg.mid, 0, book, a_to_b=True, amount_in=amount_in, amount_out=got)

    def test_accepts_both_directions_inside_the_tolerance(self):
        book = Book()
        leg = _leg(100)  # 1% below mid
        for a_to_b in (True, False):
            amount_in, got = _fill(leg, a_to_b, book)
            assert band_allows(leg.mid, 0, book, a_to_b=a_to_b, amount_in=amount_in, amount_out=got)

    def test_the_tilt_widens_the_band_rather_than_tripping_it(self):
        """A tilt at the cap is not itself a reason to refuse: the band grows by |tilt| so that a
        fill the skew priced is not rejected by the band for having been priced."""
        book = Book()
        leg = _leg(0)
        amount_in, got = _fill(leg, a_to_b=True, book=book)
        assert band_allows(leg.mid, book.max_tilt_bps, book, a_to_b=True, amount_in=amount_in, amount_out=got)


class TestPnlIsDecomposed:
    """Almost all of `pnl_a` is the mark-to-market of holding tokenB while the mid moved. The
    number that measures the policy is what is left after that is removed."""

    def test_with_no_flow_the_whole_pnl_is_the_hold(self):
        r = run("static", Series(), Book(arrival_bps=0), tilted=False, bounded=False, banded=False)
        assert r.fills == 0
        assert r.hold_pnl_a == r.pnl_a
        assert r.trading_pnl_a == 0

    def test_trading_pnl_is_total_less_hold(self):
        r = run("static", Series(), Book(), tilted=False, bounded=False, banded=False)
        assert r.trading_pnl_a == r.pnl_a - r.hold_pnl_a
        assert r.hold_pnl_a != 0


class TestTheAnchorSignal:
    def test_a_leg_at_the_mid_needs_no_correction(self):
        assert anchor_tilt_bps(ONE_E18 // 2) == 0

    def test_excess_token_a_is_made_dear_again(self):
        """A constant-product leg holding excess tokenA prices tokenA below the mid; the anchor is
        negative, which in the instruction's convention makes tokenA expensive."""
        assert anchor_tilt_bps(ONE_E18 * 51 // 100) < 0

    def test_the_anchored_quote_sits_on_the_mid_to_within_the_spread(self):
        from reference_model.crosschain import leg_weight
        from reference_model.simulate import _quote

        book = Book(fill_fraction_bps=1)  # a dust fill, so the curve's own slippage is negligible
        leg = _leg(300)  # 3% below mid
        tilt = anchor_tilt_bps(leg_weight(leg.balance_a, leg.balance_b, leg.mid)["weightA"])
        amount_in = leg.balance_a * book.fill_fraction_bps // BPS
        got = _quote(leg, tilt, True, amount_in, book)
        realised = got * ONE_E18 // amount_in
        off_bps = (realised - MID) * BPS // MID
        assert -book.spread_bps - 8 <= off_bps <= 0, off_bps  # spread plus the curve's own slippage

    def test_an_unknown_signal_is_refused(self):
        import pytest

        with pytest.raises(ValueError):
            run("x", Series(ticks=2), Book(signal="tilt"), tilted=True, bounded=True, banded=True)
