"""Stress the chosen signal: is the gain a knee or a spike, and does the result survive the
reference cadence, the depth of the taker's alternative, and the direction of flow?"""

import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.simulate import Book, Series, run  # noqa: E402

SEEDS = range(1, 25)
ZENTIS = dict(tilted=True, bounded=True, banded=True)
STATIC = dict(tilted=False, bounded=False, banded=False)
BASE = dict(external_depth_a=5_000_000, arrival_bps=4000, fill_fraction_bps=50, signal="anchor_own", kappa_bps=10_000)


def line(label, series, **kw):
    by_seed = [Series(**{**series.__dict__, "seed": seed}) for seed in SEEDS]
    book = Book(**{**BASE, **kw})
    statics = [run("static", s, Book(**{**book.__dict__, "signal": "cross_leg"}), **STATIC) for s in by_seed]
    runs = [run("z", s, book, **ZENTIS) for s in by_seed]
    diffs = [r.trading_pnl_a - c.trading_pnl_a for r, c in zip(runs, statics)]
    ahead = sum(d > 0 for d in diffs)
    print(f"{label:44}{st.mean(diffs):9.0f}{st.pstdev(diffs):8.0f}{min(diffs):9.0f}{ahead:4d}/24"
          f"{st.mean(r.fills for r in runs):7.0f}{st.mean(r.refused for r in runs):7.1f}{st.mean(r.transfers for r in runs):6.0f}"
          f"{st.mean(c.trading_pnl_a for c in statics):10.0f}")


if __name__ == "__main__":
    print(f"{'case':44}{'mean':>9}{'sd':>8}{'worst':>9}{'ahead':>7}{'fills':>7}{'refus':>7}{'xfer':>6}{'static':>10}")
    for k in (7_500, 10_000, 12_500, 15_000):
        line(f"gain {k}", Series(), kappa_bps=k)
    for signal in ("anchor", "anchor_cross_leg", "anchor_book", "anchor_own"):
        line(f"decomposition {signal} @10000", Series(), signal=signal)
    for interval in (1, 5, 20, 60):
        line(f"refs every {interval} ticks", Series(), ref_interval_ticks=interval)
    for depth in (1_000_000, 2_000_000, 5_000_000, 20_000_000, 200_000_000):
        line(f"external depth {depth:,}", Series(), external_depth_a=depth)
    for flow in (3_500, 5_000, 6_500, 8_000):
        line(f"flow tokenA-in {flow} bps", Series(), flow_a_to_b_bps=flow)
    for name, s in (("calm vol 5", Series(trend_bps=0, vol_bps=5)), ("flat", Series(trend_bps=0)),
                    ("trend -300", Series(trend_bps=-300)), ("vol 50", Series(vol_bps=50))):
        line(f"regime {name}", s)
    line("three legs", Series(), legs=3)
    line("fills 1% of inventory", Series(), fill_fraction_bps=100)
