#!/usr/bin/env python3
"""Emits allocation fixture vectors, consumed by cre/slow/allocation.test.ts.

There is no Solidity side to check here: the instruction consumes a published budget, it does not
allocate one. The parity that matters is the model against the workflow.

Seed is pinned so the output is reproducible; re-run and commit the diff if the model changes.
"""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.allocation import allocate_band_edge

SEED = 1
RANDOM_CASE_COUNT = 32
STRENGTH_BPS = 10_000
MIN_EDGE_BPS = 1
MAX_EDGE_BPS = 500

OUT = Path(__file__).resolve().parents[3] / "cre" / "slow" / "allocation_vectors.json"


def _named() -> list[dict]:
    return [
        {"name": "one leg, nothing to allocate between", "baseEdgeBps": 57,
         "ownLeans": [100], "crowdingBps": [7000]},
        {"name": "no crowding data anywhere reproduces the flat budget", "baseEdgeBps": 57,
         "ownLeans": [100, -50, 10], "crowdingBps": [0, 0, 0]},
        {"name": "a contested leg is throttled and the others are not", "baseEdgeBps": 57,
         "ownLeans": [100, 0, 100], "crowdingBps": [7000, 0, -7000]},
        {"name": "the venue leaning against us is not competition", "baseEdgeBps": 57,
         "ownLeans": [-100, -100], "crowdingBps": [9000, -9000]},
        {"name": "a fully crowded leg falls to the floor, never to zero", "baseEdgeBps": 57,
         "ownLeans": [100, -100], "crowdingBps": [10000, -10000]},
        {"name": "a flat leg of ours is never contested", "baseEdgeBps": 120,
         "ownLeans": [0, 0], "crowdingBps": [10000, -10000]},
        {"name": "the ceiling binds before the crowding does", "baseEdgeBps": 900,
         "ownLeans": [10, 10], "crowdingBps": [0, 5000]},
    ]


def _random(rng: random.Random) -> list[dict]:
    cases = []
    for i in range(RANDOM_CASE_COUNT):
        n = rng.randint(1, 4)
        cases.append({
            "name": f"random {i}",
            "baseEdgeBps": rng.randint(0, 800),
            "ownLeans": [rng.randint(-10**18, 10**18) for _ in range(n)],
            "crowdingBps": [rng.randint(-10_000, 10_000) for _ in range(n)],
        })
    return cases


def main() -> None:
    rng = random.Random(SEED)
    cases = _named() + _random(rng)
    for case in cases:
        case["expected"] = [
            str(v)
            for v in allocate_band_edge(
                case["baseEdgeBps"], case["ownLeans"], case["crowdingBps"],
                STRENGTH_BPS, MIN_EDGE_BPS, MAX_EDGE_BPS,
            )
        ]
        case["ownLeans"] = [str(v) for v in case["ownLeans"]]
        case["crowdingBps"] = [str(v) for v in case["crowdingBps"]]
        case["baseEdgeBps"] = str(case["baseEdgeBps"])
    payload = {"seed": SEED, "strengthBps": STRENGTH_BPS,
               "minEdgeBps": MIN_EDGE_BPS, "maxEdgeBps": MAX_EDGE_BPS, "cases": cases}
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {len(cases)} cases to {OUT}")


if __name__ == "__main__":
    main()
