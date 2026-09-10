#!/usr/bin/env python3
"""Run the three-policy harness at the shipped gains and write the one artefact every number in the
README and on the console traces back to.

Static is the control: the same book, the same path, no shift at all. The result per regime is the
trading PnL of the reservation policy against static across every seed, with the hold removed, and
the inventory dispersion beside it. Mean, standard deviation and worst case, never one path, and
never a "bps saved" headline: in a trending market an inventory policy loses mean by construction,
and what it buys is dispersion.

    python3 packages/sim-report/run.py            # writes results/latest.json
"""

import json
import statistics as st
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "reference-model"))

from reference_model.simulate import Book, Series, run  # noqa: E402

SEEDS = list(range(1, 25))
ZENTIS = dict(tilted=True, bounded=True, banded=True)
STATIC = dict(tilted=False, bounded=False, banded=False)
BOOK = dict(
    external_depth_a=5_000_000,
    arrival_bps=4000,
    fill_fraction_bps=50,
    signal="anchor_own_book",
    kappa_bps=10_000,
    kappa_book_bps=5_000,
)
REGIMES = {
    "trend": dict(trend_bps=300, vol_bps=25),
    "flat": dict(trend_bps=0, vol_bps=25),
    "reversed": dict(trend_bps=-300, vol_bps=25),
    "calm": dict(trend_bps=0, vol_bps=5),
    "volatile": dict(trend_bps=300, vol_bps=50),
}


def _drift(r) -> float:
    return max(abs(sum(t["weights"]) / len(t["weights"]) / 1e18 - 0.5) for t in r.ticks)


def _regime(name: str, params: dict) -> dict:
    book = Book(**BOOK)
    control = Book(**{**BOOK, "signal": "cross_leg"})
    diffs, drifts, fills, refused, transfers, static_pnl = [], [], [], [], [], []
    for seed in SEEDS:
        series = Series(seed=seed, **params)
        s = run("static", series, control, **STATIC)
        z = run("zentis", series, book, **ZENTIS)
        diffs.append(z.trading_pnl_a - s.trading_pnl_a)
        drifts.append(_drift(z))
        fills.append(z.fills)
        refused.append(z.refused)
        transfers.append(z.transfers)
        static_pnl.append(s.trading_pnl_a)
    return {
        "regime": name,
        "trendBps": params["trend_bps"],
        "volBpsPerTick": params["vol_bps"],
        "seeds": len(SEEDS),
        "meanVsStatic": round(st.mean(diffs)),
        "sdVsStatic": round(st.pstdev(diffs)),
        "worstVsStatic": min(diffs),
        "seedsAhead": sum(d > 0 for d in diffs),
        "meanStaticTradingPnl": round(st.mean(static_pnl)),
        "meanBookDrift": round(st.mean(drifts), 4),
        "meanFills": round(st.mean(fills), 1),
        "meanRefused": round(st.mean(refused), 2),
        "meanTransfers": round(st.mean(transfers), 2),
    }


def main() -> None:
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "modelCommit": commit,
        "unit": "raw tokenA (6dp), trading PnL with the hold removed, reservation policy minus static",
        "book": BOOK,
        "series": {"ticks": Series().ticks, "seeds": SEEDS[0], "seedsTo": SEEDS[-1]},
        "regimes": [_regime(name, params) for name, params in REGIMES.items()],
    }
    path = Path(__file__).resolve().parent / "results" / "latest.json"
    path.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {path.relative_to(ROOT)} at model commit {commit[:12]}")


if __name__ == "__main__":
    main()
