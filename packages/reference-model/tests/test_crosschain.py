"""What the tilt policy can and cannot reach, pinned so that the gain and the cap are set against
the truth rather than against a comment."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.crosschain import distribute, leg_weight  # noqa: E402

ONE = 10**18


def test_two_legs_saturate_at_half_the_gain():
    """x = (w0 - w1) / 2 lies in [-1/2, 1/2], so kappa = cap leaves the clamp unreachable."""
    all_a = leg_weight(10**9, 0, ONE)
    all_b = leg_weight(0, 10**9, ONE)
    tilts = [p["tiltBps"] for p in distribute([all_a, all_b], 500, 500)]
    assert tilts == [250, -250]


def test_n_legs_saturate_at_the_gain_times_n_minus_one_over_n():
    all_a = leg_weight(10**9, 0, ONE)
    all_b = leg_weight(0, 10**9, ONE)
    tilts = [p["tiltBps"] for p in distribute([all_a, all_b, all_b], 500, 500)]
    assert tilts == [333, -166, -166]


def test_doubling_the_gain_reaches_the_cap_on_two_legs():
    all_a = leg_weight(10**9, 0, ONE)
    all_b = leg_weight(0, 10**9, ONE)
    tilts = [p["tiltBps"] for p in distribute([all_a, all_b], 1_000, 500)]
    assert tilts == [500, -500]


def test_size_imbalance_at_the_mid_is_invisible_to_the_weight():
    """Two legs both priced at the mid, one four times the other: the policy sees nothing."""
    big = leg_weight(40_000_000, 40_000_000, ONE)
    small = leg_weight(10_000_000, 10_000_000, ONE)
    assert [p["tiltBps"] for p in distribute([big, small], 500, 500)] == [0, 0]


class TestReservation:
    """The reservation policy: anchor each leg to the mid, then skew on the leg and on the book."""

    def test_a_balanced_book_at_the_mid_tilts_nothing(self):
        from reference_model.crosschain import reservation

        legs = [leg_weight(10**7, 10**7, ONE), leg_weight(3 * 10**7, 3 * 10**7, ONE)]
        assert [p["tiltBps"] for p in reservation(legs, 10_000, 5_000, 500)] == [0, 0]

    def test_excess_token_a_is_repriced_dear_and_the_skew_softens_it(self):
        """A leg 4% below the mid holds excess tokenA. The anchor alone would be about -400 bps;
        the own-leg skew at 10,000 takes a quarter of that back, and the book skew a little more."""
        from reference_model.crosschain import anchor_tilt_bps, reservation

        a = 10_000_000
        cheap = leg_weight(a, a * 96 // 100, ONE)
        even = leg_weight(a, a, ONE)
        anchor = anchor_tilt_bps(cheap["weightA"])
        assert -410 <= anchor <= -390
        [p0, p1] = reservation([cheap, even], 10_000, 0, 500)
        assert -310 <= p0["tiltBps"] <= -290
        assert p1["tiltBps"] == 0
        [q0, q1] = reservation([cheap, even], 10_000, 5_000, 500)
        assert q0["tiltBps"] > p0["tiltBps"]
        assert q1["tiltBps"] > 0  # the book holds excess tokenA, so the even leg sheds too

    def test_gain_of_four_times_the_basis_reproduces_the_plain_curve(self):
        from reference_model.crosschain import reservation

        for eps in (1, 3, 8):
            a = 10_000_000
            leg = leg_weight(a, a * (100 - eps) // 100, ONE)
            [p] = reservation([leg], 40_000, 0, 10_000)
            assert abs(p["tiltBps"]) <= 2 * eps, (eps, p["tiltBps"])

    def test_the_cap_binds(self):
        from reference_model.crosschain import reservation

        a = 10_000_000
        leg = leg_weight(a, a * 80 // 100, ONE)
        [p] = reservation([leg], 10_000, 0, 500)
        assert p["tiltBps"] == -500

    def test_the_slope_is_negative_and_matches_a_finite_difference(self):
        """Accumulating tokenA lowers the leg's price, so the anchor must move the tilt down. The
        published derivative is what the instruction extrapolates with between references."""
        from reference_model.crosschain import reservation

        a, b = 10_000_000, 9_800_000
        delta = 10_000
        [p] = reservation([leg_weight(a, b, ONE)], 10_000, 0, 10_000)
        [q] = reservation([leg_weight(a + delta, b, ONE)], 10_000, 0, 10_000)
        assert p["dTiltPerA"] < 0
        predicted = p["tiltBps"] + p["dTiltPerA"] * delta // ONE
        assert abs(predicted - q["tiltBps"]) <= 1

    def test_the_book_term_is_the_same_on_every_leg(self):
        from reference_model.crosschain import reservation

        a = 10_000_000
        legs = [leg_weight(a, a, ONE), leg_weight(a, a * 90 // 100, ONE), leg_weight(a, a, ONE)]
        ps = reservation(legs, 0, 3_000, 500)
        assert ps[0]["tiltBps"] == ps[2]["tiltBps"] > 0
