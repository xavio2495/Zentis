#!/usr/bin/env python3
"""Emits volatility fixture vectors, consumed by cre/slow/volatility.test.ts.

There is no Solidity side: the spread instruction consumes a published term, it does not measure
one. The parity that matters is the model against the workflow, on irregular series with gaps,
same-second samples and moves in both directions.

Seed is pinned so the output is reproducible; re-run and commit the diff if the model changes.
"""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.volatility import sigma_over_horizon_bps, volatility_spread_bps

SEED = 1
RANDOM_CASE_COUNT = 32
HORIZON_SECONDS = 60
MULTIPLIER_BPS = 10_000
CAP_BPS = 200
MID = 275_818_853_000_085_890_554_200_491

OUT = Path(__file__).resolve().parents[3] / "packages" / "strategy-sdk" / "volatility_vectors.json"


def _steps(steps_bps, dt=60):
    out, mid, t = [(0, MID)], MID, 0
    for step in steps_bps:
        mid = mid * (10_000 + step) // 10_000
        t += dt
        out.append((t, mid))
    return out


def _named():
    return [
        {"name": "empty", "samples": []},
        {"name": "one sample", "samples": [(0, MID)]},
        {"name": "flat", "samples": _steps([0] * 10)},
        {"name": "steady 30 bps a minute", "samples": _steps([30] * 20)},
        {"name": "alternating 30 bps", "samples": _steps([-30, 30] * 10)},
        {"name": "sparse, 60 bps every four minutes", "samples": _steps([60] * 5, dt=240)},
        {"name": "two swaps in one second", "samples": [(0, MID), (60, MID * 1003 // 1000), (60, MID), (120, MID)]},
        {"name": "one violent move, then calm", "samples": _steps([800] + [0] * 30)},
        {"name": "past the cap", "samples": _steps([300, -300] * 10)},
    ]


def _random(rng):
    cases = []
    for i in range(RANDOM_CASE_COUNT):
        n = rng.randrange(2, 60)
        mid, t, samples = MID, 0, []
        for _ in range(n):
            t += rng.choice((0, 1, 12, 60, 60, 300, 1800))
            mid = mid * (10_000 + rng.randint(-120, 120)) // 10_000
            samples.append((t, mid))
        cases.append({"name": f"random {i}", "samples": samples})
    return cases


def main():
    rng = random.Random(SEED)
    cases = []
    for case in _named() + _random(rng):
        cases.append({
            "name": case["name"],
            "samples": [[str(t), str(m)] for t, m in case["samples"]],
            "sigmaBps": str(sigma_over_horizon_bps(case["samples"], HORIZON_SECONDS)),
            "spreadTermBps": str(volatility_spread_bps(case["samples"], HORIZON_SECONDS, MULTIPLIER_BPS, CAP_BPS)),
        })
    OUT.write_text(json.dumps({
        "seed": SEED, "horizonSeconds": HORIZON_SECONDS, "multiplierBps": MULTIPLIER_BPS,
        "capBps": CAP_BPS, "cases": cases,
    }, indent=2) + "\n")
    print(f"wrote {len(cases)} cases to {OUT}")


if __name__ == "__main__":
    main()
