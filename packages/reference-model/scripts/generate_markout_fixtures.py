#!/usr/bin/env python3
"""Emits markout fixture vectors, consumed by cre/slow/workflow.test.ts to check that the
TypeScript in the workflow and the Python reference model compute the same number.

There is no Solidity implementation to check against here: the spread instruction consumes a
published markout, it does not measure one. So the parity that matters is model against workflow.

Seed is pinned so the output is reproducible; re-run and commit the diff if the model changes.
"""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.markout import markout_bps

SEED = 1
RANDOM_CASE_COUNT = 32
HORIZON_SECONDS = 300
CAP_BPS = 200

OUT = Path(__file__).resolve().parents[3] / "cre" / "slow" / "markout_vectors.json"

BASE_MID = 275_818_853_000_085_890_554_200_491
ONE = 10**18


def _fill(timestamp: int, is_a_to_b: bool, size_a: int, price: int) -> dict:
    """A fill of `size_a` raw tokenA that executed at `price`, in whichever direction."""
    other = size_a * price // ONE
    if other <= 0:
        raise ValueError("size too small to price at this mid")
    if is_a_to_b:
        return {"timestamp": timestamp, "isAToB": True, "amountIn": size_a, "amountOut": other}
    return {"timestamp": timestamp, "isAToB": False, "amountIn": other, "amountOut": size_a}


def _named_cases() -> list[dict]:
    refs = [
        {"updatedAt": 1000, "mid": BASE_MID},
        {"updatedAt": 1400, "mid": BASE_MID * 101 // 100},
        {"updatedAt": 1800, "mid": BASE_MID * 99 // 100},
    ]
    return [
        {
            "name": "no fills at all",
            "fills": [],
            "references": refs,
        },
        {
            "name": "every fill is younger than the horizon, so nothing has matured",
            "fills": [_fill(1700, True, 15_000_000, BASE_MID)],
            "references": refs,
        },
        {
            "name": "the maker bought tokenA and the price rose, which is a favourable markout",
            "fills": [_fill(1000, True, 15_000_000, BASE_MID)],
            "references": refs,
        },
        {
            "name": "the maker sold tokenA and the price rose, which is adverse selection",
            "fills": [_fill(1000, False, 15_000_000, BASE_MID)],
            "references": refs,
        },
        {
            "name": "a favourable markout is floored, never narrowing the spread",
            "fills": [_fill(1000, True, 15_000_000, BASE_MID * 90 // 100)],
            "references": refs,
        },
        {
            "name": "a large adverse fill outweighs several small favourable ones",
            "fills": [
                _fill(1000, False, 15_000_000, BASE_MID),
                _fill(1010, True, 10_000, BASE_MID),
                _fill(1020, True, 10_000, BASE_MID),
            ],
            "references": refs,
        },
        {
            "name": "a violent move saturates the cap rather than bricking the leg",
            "fills": [_fill(1000, False, 15_000_000, BASE_MID // 2)],
            "references": refs,
        },
        {
            "name": "no reference has ever been published",
            "fills": [_fill(1000, True, 15_000_000, BASE_MID)],
            "references": [],
        },
    ]


def _random_cases(rng: random.Random) -> list[dict]:
    cases = []
    for i in range(RANDOM_CASE_COUNT):
        refs = []
        stamp = 1000
        mid = BASE_MID
        for _ in range(rng.randint(1, 5)):
            mid = mid * rng.randint(90, 110) // 100
            refs.append({"updatedAt": stamp, "mid": mid})
            stamp += rng.randint(60, 900)

        fills = []
        for _ in range(rng.randint(0, 6)):
            fills.append(
                _fill(
                    rng.randint(900, stamp),
                    rng.random() < 0.5,
                    rng.randint(10_000, 50_000_000),
                    BASE_MID * rng.randint(80, 120) // 100,
                )
            )
        cases.append({"name": f"random {i}", "fills": fills, "references": refs})
    return cases


def main() -> None:
    rng = random.Random(SEED)
    cases = _named_cases() + _random_cases(rng)

    for case in cases:
        result = markout_bps(case["fills"], case["references"], HORIZON_SECONDS, CAP_BPS)
        case["expected"] = {
            "matured": result.matured,
            "skipped": result.skipped,
            "weightedBps": str(result.weighted_bps),
            "publishedBps": str(result.published_bps),
        }

    payload = {
        "seed": SEED,
        "horizonSeconds": HORIZON_SECONDS,
        "capBps": CAP_BPS,
        "cases": [
            {
                "name": c["name"],
                "fills": [
                    {
                        "timestamp": str(f["timestamp"]),
                        "isAToB": f["isAToB"],
                        "amountIn": str(f["amountIn"]),
                        "amountOut": str(f["amountOut"]),
                    }
                    for f in c["fills"]
                ],
                "references": [
                    {"updatedAt": str(r["updatedAt"]), "mid": str(r["mid"])} for r in c["references"]
                ],
                "expected": c["expected"],
            }
            for c in cases
        ],
    }
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {len(cases)} cases to {OUT}")


if __name__ == "__main__":
    main()
