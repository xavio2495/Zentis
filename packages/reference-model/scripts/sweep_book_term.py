"""Dial the book-level skew on top of the winning own-leg anchor.

The own-leg term is what a single-chain maker could compute. The book term needs every leg's
inventory, which is what the cross-chain reference carries. So this is the experiment that says
what the reference is worth: mean PnL, dispersion across seeds, and how far the book drifts.
"""

import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.simulate import Book, Series, run  # noqa: E402

SEEDS = range(1, 25)
ZENTIS = dict(tilted=True, bounded=True, banded=True)
STATIC = dict(tilted=False, bounded=False, banded=False)
BASE = dict(external_depth_a=5_000_000, arrival_bps=4000, fill_fraction_bps=50, signal="anchor_own_book", kappa_bps=10_000)
BOOK_GAINS = (-5_000, -2_000, 0, 2_000, 5_000, 10_000, 20_000)


def drift(r):
    return max(abs(sum(t["weights"]) / len(t["weights"]) / 1e18 - 0.5) for t in r.ticks)


if __name__ == "__main__":
    print(f"{'regime':8}{'kbook':>7}{'mean':>9}{'sd':>8}{'worst':>9}{'ahead':>7}{'drift':>8}")
    for name, series in (("trend", Series()), ("flat", Series(trend_bps=0)), ("vol50", Series(vol_bps=50))):
        by_seed = [Series(**{**series.__dict__, "seed": seed}) for seed in SEEDS]
        statics = [run("static", s, Book(**{**BASE, "signal": "cross_leg"}), **STATIC) for s in by_seed]
        for gain in BOOK_GAINS:
            runs = [run("z", s, Book(**BASE, kappa_book_bps=gain), **ZENTIS) for s in by_seed]
            diffs = [r.trading_pnl_a - c.trading_pnl_a for r, c in zip(runs, statics)]
            print(f"{name:8}{gain:7d}{st.mean(diffs):9.0f}{st.pstdev(diffs):8.0f}{min(diffs):9.0f}"
                  f"{sum(d > 0 for d in diffs):4d}/24{st.mean(drift(r) for r in runs):8.4f}")
