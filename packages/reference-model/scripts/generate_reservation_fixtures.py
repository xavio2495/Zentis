#!/usr/bin/env python3
"""Emits reservation-policy fixture vectors, consumed by cre/fast/reservation.test.ts.

The workflow's policy has to agree with the Python model exactly, because the model is what the
harness and the write-up run on. Seed is pinned so the output is reproducible; re-run and commit
the diff if the policy changes.
"""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.crosschain import leg_weight, reservation

SEED = 1
RANDOM_CASE_COUNT = 32
MAX_TILT_BPS = 500
MID = 275_818_853_000_085_890_554_200_491  # the live Base Sepolia reference mid

OUT = Path(__file__).resolve().parents[3] / "cre" / "fast" / "reservation_vectors.json"


def _named() -> list[dict]:
    a = 15_000_000
    b = a * MID // 10**18
    return [
        {"name": "one leg at the mid", "kappaOwnBps": 10_000, "kappaBookBps": 5_000,
         "legs": [[a, b]]},
        {"name": "two legs at the mid, four times apart in size", "kappaOwnBps": 10_000, "kappaBookBps": 5_000,
         "legs": [[4 * a, 4 * b], [a, b]]},
        {"name": "one leg 4% below the mid, the other even", "kappaOwnBps": 10_000, "kappaBookBps": 5_000,
         "legs": [[a, b * 96 // 100], [a, b]]},
        {"name": "one leg 20% below the mid: the cap binds", "kappaOwnBps": 10_000, "kappaBookBps": 5_000,
         "legs": [[a, b * 80 // 100], [a, b]]},
        {"name": "gain of four times the basis is the plain curve", "kappaOwnBps": 40_000, "kappaBookBps": 0,
         "legs": [[a, b * 97 // 100]]},
        {"name": "anchor alone", "kappaOwnBps": 0, "kappaBookBps": 0,
         "legs": [[a, b * 103 // 100], [a * 103 // 100, b]]},
        {"name": "three legs, one dear", "kappaOwnBps": 10_000, "kappaBookBps": 5_000,
         "legs": [[a, b * 105 // 100], [a, b], [2 * a, 2 * b]]},
        {"name": "a leg holding no tokenB", "kappaOwnBps": 10_000, "kappaBookBps": 5_000,
         "legs": [[a, 0], [a, b]]},
    ]


def _random(rng: random.Random) -> list[dict]:
    cases = []
    for i in range(RANDOM_CASE_COUNT):
        n = rng.choice((1, 2, 2, 3))
        legs = []
        for _ in range(n):
            a = rng.randrange(1_000_000, 50_000_000)
            off = rng.uniform(-0.12, 0.12)
            legs.append([a, int(a * MID // 10**18 * (1 + off))])
        cases.append({"name": f"random {i}", "kappaOwnBps": rng.choice((0, 5_000, 10_000, 15_000)),
                      "kappaBookBps": rng.choice((0, 2_000, 5_000)), "legs": legs})
    return cases


def main() -> None:
    rng = random.Random(SEED)
    cases = []
    for case in _named() + _random(rng):
        weights = [leg_weight(a, b, MID) for a, b in case["legs"]]
        policies = reservation(weights, case["kappaOwnBps"], case["kappaBookBps"], MAX_TILT_BPS)
        cases.append({
            **case,
            "legs": [[str(a), str(b)] for a, b in case["legs"]],
            "expected": [{"tiltBps": str(p["tiltBps"]), "dTiltPerA": str(p["dTiltPerA"])} for p in policies],
        })
    OUT.write_text(json.dumps({"seed": SEED, "mid": str(MID), "maxTiltBps": MAX_TILT_BPS, "cases": cases}, indent=2) + "\n")
    print(f"wrote {len(cases)} cases to {OUT}")


if __name__ == "__main__":
    main()
