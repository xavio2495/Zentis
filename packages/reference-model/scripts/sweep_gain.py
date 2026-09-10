"""Sweep the inventory gain on top of the anchor.

Near an even split the anchor is `-4 * (w - 1/2)` and an inventory skew is `+kappa * (w - 1/2)`,
so the two together interpolate between the plain constant-product curve (kappa near four times the
basis) and a curve pinned to the mid (kappa zero). The gain is therefore a dial between paying
arbitrage and carrying inventory, and this prints where each setting lands on both.

`anchor_own` skews on the leg's own weight, which a single-chain maker can see. `anchor_book` skews
on the book's weight across every leg, which only a cross-chain reference can know. The difference
between the two rows at the same gain is what the cross-chain reference is worth.
"""

import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.simulate import Book, Series, run  # noqa: E402

SEEDS = range(1, 25)
ZENTIS = dict(tilted=True, bounded=True, banded=True)
STATIC = dict(tilted=False, bounded=False, banded=False)
FAVOURABLE = dict(external_depth_a=5_000_000, arrival_bps=4000, fill_fraction_bps=50)
GAINS = (0, 2_000, 5_000, 10_000, 20_000, 40_000)


def drift(r):
    return max(abs(sum(t["weights"]) / len(t["weights"]) / 1e18 - 0.5) for t in r.ticks)


def row(runs, statics):
    diffs = [r.trading_pnl_a - s.trading_pnl_a for r, s in zip(runs, statics)]
    return (st.mean(diffs), st.pstdev(diffs), min(diffs), st.mean(r.fills for r in runs),
            st.mean(r.refused for r in runs), st.mean(r.transfers for r in runs),
            st.mean(r.transfer_cost_a for r in runs), st.mean(drift(r) for r in runs))


def sweep(title, series, **book_kw):
    print(f"\n== {title}")
    print(f"{'signal':12}{'kappa':>7}{'mean':>9}{'sd':>8}{'worst':>9}{'fills':>7}{'refused':>8}{'xfers':>7}{'xfercost':>9}{'drift':>8}")
    by_seed = [Series(**{**series.__dict__, "seed": seed}) for seed in SEEDS]
    statics = [run("static", s, Book(**FAVOURABLE, **book_kw), **STATIC) for s in by_seed]
    for signal in ("anchor_own", "anchor_book"):
        for kappa in GAINS:
            runs = [run(signal, s, Book(**FAVOURABLE, **book_kw, signal=signal, kappa_bps=kappa), **ZENTIS) for s in by_seed]
            m, sd, worst, fills, refused, xfers, cost, d = row(runs, statics)
            print(f"{signal:12}{kappa:7d}{m:9.0f}{sd:8.0f}{worst:9.0f}{fills:7.0f}{refused:8.1f}{xfers:7.0f}{cost:9.0f}{d:8.4f}")


if __name__ == "__main__":
    sweep("trend, refs every tick, impulse off", Series(), impulse=False)
    sweep("flat, refs every tick, impulse off", Series(trend_bps=0), impulse=False)
    sweep("trend, refs every 5 ticks, impulse off", Series(), impulse=False, ref_interval_ticks=5)
    sweep("trend, refs every tick, impulse ON", Series(), impulse=True)
