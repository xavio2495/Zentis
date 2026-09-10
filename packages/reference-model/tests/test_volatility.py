"""Realised volatility over the reference cadence, from an irregularly sampled price series."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.volatility import (  # noqa: E402
    isqrt,
    realised_variance_rate,
    sigma_over_horizon_bps,
    volatility_spread_bps,
)

MID = 275_818_853_000_085_890_554_200_491


def _series(steps_bps: list[int], dt: int = 60) -> list[tuple[int, int]]:
    """A series that moves by each step in bps, one sample every `dt` seconds."""
    out, mid, t = [(0, MID)], MID, 0
    for step in steps_bps:
        mid = mid * (10_000 + step) // 10_000
        t += dt
        out.append((t, mid))
    return out


def test_isqrt_is_the_floor_of_the_root():
    for n in (0, 1, 2, 3, 4, 15, 16, 17, 10**18, 10**18 + 1, (1 << 127) - 1):
        r = isqrt(n)
        assert r * r <= n < (r + 1) * (r + 1)


def test_fewer_than_two_samples_is_no_evidence():
    assert realised_variance_rate([]) == (0, 0)
    assert realised_variance_rate([(0, MID)]) == (0, 0)
    assert volatility_spread_bps([(0, MID)], 60, 10_000, 200) == 0


def test_a_flat_series_has_no_volatility():
    assert volatility_spread_bps(_series([0] * 20), 60, 10_000, 200) == 0


def test_a_steady_move_of_n_bps_per_cadence_measures_n():
    """Steps of 30 bps every 60 seconds, horizon 60 seconds: sigma over the horizon is 30."""
    assert sigma_over_horizon_bps(_series([30] * 20), 60) == 30
    assert sigma_over_horizon_bps(_series([-30, 30] * 10), 60) == 30


def test_sigma_scales_with_the_square_root_of_the_horizon():
    series = _series([30] * 20)
    assert sigma_over_horizon_bps(series, 240) == 60


def test_sparse_samples_are_scaled_by_elapsed_time():
    """The same 30 bps per minute, sampled every 4 minutes, is a 60 bps step: same variance rate."""
    assert sigma_over_horizon_bps(_series([60] * 5, dt=240), 60) == 30


def test_samples_in_the_same_second_keep_the_last():
    """Two swaps in one block are one observation; a zero interval must not count as a move."""
    series = [(0, MID), (60, MID * 1003 // 1000), (60, MID), (120, MID)]
    assert sigma_over_horizon_bps(series, 60) == 0


def test_unsorted_input_is_refused():
    import pytest

    with pytest.raises(ValueError):
        realised_variance_rate([(60, MID), (0, MID)])


def test_the_published_term_is_multiplier_times_sigma_capped():
    series = _series([30] * 20)
    assert volatility_spread_bps(series, 60, 10_000, 200) == 30
    assert volatility_spread_bps(series, 60, 15_000, 200) == 45
    assert volatility_spread_bps(series, 60, 15_000, 40) == 40
