#!/usr/bin/env python3
"""Day 4, task 4.4: publish one anti-symmetric pair of references from the two legs' live inventory.

Supersedes `poke_ref_from_subgraph.py`, which wrote a measured `mid` but a hardcoded `tiltBps = 0`
because no position existed to be imbalanced. Now one does, on both chains, under one `positionId` —
so the tilt is computed from what the maker actually holds, by the policy in
`reference_model.crosschain`, and the two legs' tilts are equal and opposite by construction.

Everything published here is measured or derived:
  mid          the subgraph's block-pinned pool price for that chain      (as before)
  tiltBps      the cross-chain inventory policy, from Aqua balances       (new)
  dTiltPerA    that policy's own derivative, so ZentisSkew extrapolates
               between updates under the same rule                        (new)
  refBalanceA  the maker's raw tokenA balance the tilt was computed at    (new)
  updatedAt    the pinned block's timestamp, min across the two legs      (as before)

`spreadBps` and `markoutBps` remain hand-chosen; the workflow that computes them is Day 5, and
`bandEdgeBps` still has no on-chain reader at all.

Usage:
    python3 scripts/poke_anti_symmetric_refs.py            # compute and print, send nothing
    python3 scripts/poke_anti_symmetric_refs.py --send     # sign and broadcast via `cast send`
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.crosschain import anti_symmetric, leg_weight
from reference_model.onchain import block_timestamp, eth_call
from fetch_live_mid import CHAINS, fetch_chain
from poke_ref_from_subgraph import POKE_REF_SIG, POSITION_ID, UINT128_MAX, read_ref, block_number_latest

DEPLOYMENTS = Path(__file__).resolve().parents[3] / "contracts" / "deployments"

SAFE_BALANCES_SELECTOR = "0x65f2fe14"  # safeBalances(address,address,bytes32,address,address)

# Gain: a leg holding 100% tokenA against a leg holding 0% would tilt the full 500 bps. Matches
# ZentisPositionConfig.MAX_TILT_BPS, so the policy saturates exactly where the instruction clamps.
KAPPA_BPS = 500
MAX_TILT_BPS = 500

# Cap on how far ZentisSkew may extrapolate from the published tilt before the reference must be
# refreshed. 100 bps is ~18 USDC of drift at the current position size — well past the point where
# a new reference should have landed.
MAX_EXTRAP_BPS = 100

SPREAD_BPS = 10
MARKOUT_BPS = 0
BAND_EDGE_BPS = 0


def _word(raw: str, i: int) -> int:
    return int(raw[2 + i * 64 : 2 + (i + 1) * 64], 16)


def aqua_balances(rpc_url: str, d: dict, block_num: int) -> tuple[int, int]:
    """The maker's live inventory for this leg, straight out of Aqua's own accounting."""
    args = "".join(
        x.lower().replace("0x", "").rjust(64, "0")
        for x in (
            d["position"]["maker"],
            d["contracts"]["ZentisRouter"]["address"],
            d["position"]["strategyHash"],
            d["tokens"]["tokenA"]["address"],
            d["tokens"]["tokenB"]["address"],
        )
    )
    raw = eth_call(rpc_url, d["contracts"]["AquaRouter"]["address"], SAFE_BALANCES_SELECTOR + args, block_num)
    return _word(raw, 0), _word(raw, 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--send", action="store_true", help="broadcast; otherwise print only")
    args = ap.parse_args()

    now = int(time.time())
    order = list(CHAINS)  # base-sepolia, arbitrum-sepolia — leg 0 and leg 1 of the policy
    legs = {}
    for name in order:
        cfg = CHAINS[name]
        d = json.loads((DEPLOYMENTS / f"{name}.json").read_text())
        leg = fetch_chain(name, cfg, now)
        leg["rpcUrl"] = cfg["rpc_url"]
        leg["deployment"] = d
        leg["registry"] = d["contracts"]["ZentisRefRegistry"]["address"]
        leg["pinnedTimestamp"] = block_timestamp(cfg["rpc_url"], leg["pinnedBlock"])
        leg["prev"] = read_ref(cfg["rpc_url"], leg["registry"])
        balance_a, balance_b = aqua_balances(cfg["rpc_url"], d, block_number_latest(cfg["rpc_url"]))
        if balance_a == 0 and balance_b == 0:
            raise SystemExit(f"{name}: the position holds nothing — has it been shipped?")
        leg["inventory"] = leg_weight(balance_a, balance_b, leg["mid"])
        legs[name] = leg

    policy0, policy1 = anti_symmetric(
        legs[order[0]]["inventory"], legs[order[1]]["inventory"], KAPPA_BPS, MAX_TILT_BPS
    )
    for name, policy in zip(order, (policy0, policy1)):
        legs[name]["policy"] = policy

    # One updatedAt and one seq across both legs: they describe a single cross-chain instant, and a
    # reader must be able to tell they came from one observation by comparing seq.
    updated_at = min(leg["pinnedTimestamp"] for leg in legs.values())
    seq = max(leg["prev"]["seq"] for leg in legs.values()) + 1

    for name in order:
        leg = legs[name]
        prev, inv, policy = leg["prev"], leg["inventory"], leg["policy"]
        if leg["mid"] == 0 or leg["mid"] > UINT128_MAX:
            raise SystemExit(f"{name}: mid {leg['mid']} is not a storable uint128")
        if updated_at < prev["updatedAt"]:
            raise SystemExit(
                f"{name}: updatedAt {updated_at} is older than the stored {prev['updatedAt']}; "
                "the registry would reject this write"
            )

        print(
            f"{name:>18} | registry {leg['registry']}\n"
            f"{'':>18} | inventory A {inv['balanceA']} | B {inv['balanceB']} "
            f"(= {inv['bInA']} in A) | weightA {inv['weightA'] / 1e18:.4f}\n"
            f"{'':>18} | mid {prev['mid']} -> {leg['mid']}\n"
            f"{'':>18} | tiltBps {policy['tiltBps']:+d} | dTiltPerA {policy['dTiltPerA']} "
            f"| refBalanceA {inv['balanceA']}\n"
            f"{'':>18} | seq {prev['seq']} -> {seq} | updatedAt {prev['updatedAt']} -> {updated_at}"
        )

        ref_tuple = (
            f"({leg['mid']},{SPREAD_BPS},{policy['tiltBps']},{updated_at},{seq},"
            f"{inv['balanceA']},{policy['dTiltPerA']},{MAX_EXTRAP_BPS},{MARKOUT_BPS},{BAND_EDGE_BPS})"
        )
        cmd = [
            "cast", "send", leg["registry"], POKE_REF_SIG, POSITION_ID, ref_tuple,
            "--rpc-url", leg["rpcUrl"], "--private-key", os.environ.get("WALLET_PRIVATE_KEY", ""),
        ]
        if not args.send:
            printable = " ".join(c if c != cmd[-1] else "$WALLET_PRIVATE_KEY" for c in cmd)
            print(f"{'':>18} | dry run: {printable}\n")
            continue

        if not os.environ.get("WALLET_PRIVATE_KEY"):
            raise SystemExit("WALLET_PRIVATE_KEY is not set")
        # capture_output so a failure never echoes the key back through a traceback.
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise SystemExit(
                f"{name}: cast send failed:\n"
                f"{result.stderr.replace(os.environ['WALLET_PRIVATE_KEY'], '<redacted>')}"
            )
        tx = next((l.split()[-1] for l in result.stdout.splitlines() if l.startswith("transactionHash")), "?")
        print(f"{'':>18} | sent {tx}\n")

    a, b = (legs[n]["policy"]["tiltBps"] for n in order)
    assert a == -b, "the two legs' tilts must be equal and opposite"
    print(f"anti-symmetry check: {order[0]} {a:+d} bps, {order[1]} {b:+d} bps")


if __name__ == "__main__":
    main()
