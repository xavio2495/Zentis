"""The reservation policy at its chosen gains, under four volatility regimes, across fixed spreads.

What this can and cannot say. The harness's taker accepts any quote that beats a finite-depth
external venue, and that venue's slippage on a fill is well over a percent, so a wider spread loses
almost no flow here and is monotonically better up to the widest tried. The harness therefore cannot
rank spread levels, and the volatility term rests on the standard argument, not on this table. What
the table does show is where volatility dominates: at the highest regime every spread loses, and
widening is the only thing that cuts the loss."""

import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.simulate import Book, Series, run  # noqa: E402

SEEDS = range(1, 25)
ZENTIS = dict(tilted=True, bounded=True, banded=True)
BASE = dict(external_depth_a=5_000_000, arrival_bps=4000, fill_fraction_bps=50,
            signal="anchor_own_book", kappa_bps=10_000, kappa_book_bps=5_000)
SPREADS = (5, 10, 20, 35, 50, 80)

if __name__ == "__main__":
    print(f"{'vol/tick':>9}{'spread':>8}{'mean trading':>14}{'sd':>9}{'worst':>10}{'fills':>7}")
    for vol in (10, 25, 50, 100):
        by_seed = [Series(vol_bps=vol, seed=s) for s in SEEDS]
        for spread in SPREADS:
            runs = [run("z", s, Book(**BASE, spread_bps=spread), **ZENTIS) for s in by_seed]
            pnl = [r.trading_pnl_a for r in runs]
            print(f"{vol:9d}{spread:8d}{st.mean(pnl):14.0f}{st.pstdev(pnl):9.0f}{min(pnl):10.0f}{st.mean(r.fills for r in runs):7.0f}")
