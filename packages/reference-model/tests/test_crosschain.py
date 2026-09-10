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
