#!/usr/bin/env python3
"""Emits fixture vectors for the tilt/ramp arithmetic, consumed by
contracts/test/unit/ZentisTiltLib.fixtures.t.sol to check Solidity/Python parity.

Seed is pinned so the output is reproducible; re-run and commit the diff if the model changes.
"""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.tilt import effective_tilt, soft_bound_widen_bps

SEED = 1
VECTOR_COUNT = 64

INT16_MIN, INT16_MAX = -(2**15), 2**15 - 1
INT64_MIN, INT64_MAX = -(2**63), 2**63 - 1
UINT16_MAX = 2**16 - 1
UINT32_MAX = 2**32 - 1
UINT128_MAX = 2**128 - 1


def _gen_effective_tilt_vectors(rng: random.Random) -> dict:
    tilt_bps, ref_balance_a, d_tilt_per_a, max_extrap_bps = [], [], [], []
    live_balance_a, max_tilt_bps, expected = [], [], []

    for _ in range(VECTOR_COUNT):
        t = rng.randint(INT16_MIN, INT16_MAX)
        r = rng.randint(0, UINT128_MAX)
        d = rng.randint(INT64_MIN, INT64_MAX)
        e = rng.randint(0, UINT32_MAX)
        l = rng.randint(0, UINT128_MAX)
        m = rng.randint(0, UINT16_MAX)

        tilt_bps.append(t)
        ref_balance_a.append(r)
        d_tilt_per_a.append(d)
        max_extrap_bps.append(e)
        live_balance_a.append(l)
        max_tilt_bps.append(m)
        expected.append(effective_tilt(t, r, d, e, l, m))

    return {
        "tiltBps": tilt_bps,
        "refBalanceA": ref_balance_a,
        "dTiltPerA": d_tilt_per_a,
        "maxExtrapBps": max_extrap_bps,
        "liveBalanceA": live_balance_a,
        "maxTiltBps": max_tilt_bps,
        "expected": expected,
    }


def _gen_soft_bound_widen_bps_vectors(rng: random.Random) -> dict:
    live_balance_out, floor, max_widen_bps, expected = [], [], [], []

    for _ in range(VECTOR_COUNT):
        f = rng.randint(0, UINT128_MAX)
        l = rng.randint(0, UINT128_MAX)
        m = rng.randint(0, UINT16_MAX)

        live_balance_out.append(l)
        floor.append(f)
        max_widen_bps.append(m)
        expected.append(soft_bound_widen_bps(l, f, m))

    return {
        "liveBalanceOut": live_balance_out,
        "floor": floor,
        "maxWidenBps": max_widen_bps,
        "expected": expected,
    }


def main() -> None:
    rng = random.Random(SEED)
    vectors = {
        "effectiveTilt": _gen_effective_tilt_vectors(rng),
        "softBoundWidenBps": _gen_soft_bound_widen_bps_vectors(rng),
    }

    out_path = Path(__file__).resolve().parents[3] / "contracts" / "test" / "fixtures" / "tilt_vectors.json"
    out_path.write_text(json.dumps(vectors, indent=2) + "\n")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
