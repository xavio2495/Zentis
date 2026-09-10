"""Score every candidate tilt signal against the static control, across seeds and regimes.

Prints trading PnL relative to static (the hold is removed, since every policy holds the same
opening inventory through the same path), never a single path, and inventory dispersion beside it,
because dispersion is what an inventory policy controls directly and mean PnL is what it pays for
that with.
"""

import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.simulate import SIGNALS, Book, Series, run  # noqa: E402

SEEDS = range(1, 25)
ZENTIS = dict(tilted=True, bounded=True, banded=True)
STATIC = dict(tilted=False, bounded=False, banded=False)
FAVOURABLE = dict(external_depth_a=5_000_000, arrival_bps=4000, fill_fraction_bps=50)
REGIMES = {
    "trend": Series(),
    "flat": Series(trend_bps=0),
    "calm": Series(trend_bps=0, vol_bps=5),
}


def dispersion(r):
    book_drift = max(abs(sum(t["weights"]) / len(t["weights"]) / 1e18 - 0.5) for t in r.ticks)
    cross_leg = max(abs(t["weights"][0] - t["weights"][1]) / 1e18 for t in r.ticks)
    return book_drift, cross_leg


def score(series_by_seed, book):
    rows = {}
    statics = {seed: run("static", s, book, **STATIC) for seed, s in series_by_seed.items()}
    rows["static"] = _summarise(statics.values(), statics.values())
    for signal in SIGNALS:
        runs = {seed: run(signal, s, Book(**{**book.__dict__, "signal": signal}), **ZENTIS) for seed, s in series_by_seed.items()}
        rows[signal] = _summarise(runs.values(), [statics[k] for k in runs])
    return rows


def _summarise(runs, controls):
    runs, controls = list(runs), list(controls)
    diffs = [r.trading_pnl_a - c.trading_pnl_a for r, c in zip(runs, controls)]
    drifts = [dispersion(r) for r in runs]
    return dict(
        mean=st.mean(diffs), sd=st.pstdev(diffs), worst=min(diffs),
        fills=st.mean(r.fills for r in runs), refused=st.mean(r.refused for r in runs),
        transfers=st.mean(r.transfers for r in runs),
        book_drift=st.mean(d[0] for d in drifts), cross_leg=st.mean(d[1] for d in drifts),
    )


def table(title, rows):
    print(f"\n== {title}")
    print(f"{'signal':18}{'mean':>9}{'sd':>8}{'worst':>9}{'fills':>7}{'refused':>8}{'xfers':>6}{'bookdrift':>10}{'crossleg':>9}")
    for name, m in rows.items():
        print(f"{name:18}{m['mean']:9.0f}{m['sd']:8.0f}{m['worst']:9.0f}{m['fills']:7.0f}{m['refused']:8.1f}{m['transfers']:6.1f}{m['book_drift']:10.4f}{m['cross_leg']:9.4f}")


if __name__ == "__main__":
    for name, series in REGIMES.items():
        by_seed = {seed: Series(**{**series.__dict__, "seed": seed}) for seed in SEEDS}
        table(f"regime {name} (trend {series.trend_bps} bps, vol {series.vol_bps} bps/tick), depth 5M, refs every tick", score(by_seed, Book(**FAVOURABLE)))

    by_seed = {seed: Series(seed=seed) for seed in SEEDS}
    for interval in (5, 20):
        table(f"regime trend, refs every {interval} ticks", score(by_seed, Book(**FAVOURABLE, ref_interval_ticks=interval)))
    for depth in (1_000_000, 20_000_000):
        table(f"regime trend, external depth {depth:,}, refs every tick", score(by_seed, Book(**{**FAVOURABLE, "external_depth_a": depth})))
