#!/usr/bin/env python3
"""Day 2 gate: write a subgraph-derived `mid` into each chain's on-chain `ZentisRefRegistry`.

Tasks 2.1-2.3 produced a live, block-pinned `mid` per chain; task 2.6 proved the on-chain write path.
Until now those two halves were unconnected — the deployed refs carried a hand-typed `mid = 1e18`,
five orders of magnitude away from the real quote. This closes that gap so the number in the registry
traces to a query, never to a keyboard. Day 5 replaces this script with the CRE workflow; the ref
*shape* it writes is deliberately identical so that swap is a change of author, not of format.

Usage:
    python3 scripts/poke_ref_from_subgraph.py            # dry run: compute and print, send nothing
    python3 scripts/poke_ref_from_subgraph.py --send     # sign and broadcast via `cast send`

Requires WALLET_PRIVATE_KEY in the environment for --send (the registry OWNER; see docs/DECISIONS.md).
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.onchain import block_timestamp, eth_call
from fetch_live_mid import CHAINS, fetch_chain

import time

# bytes32(1) — the placeholder position identity used by the 2.6 pokes on both chains, recovered from
# the ZentisRefUpdated topic of tx 0xcda756ff... on Base Sepolia. A real `positionId` (a hash binding
# both legs) is Day 4's job; reusing this one keeps the same registry slot advancing rather than
# stranding the old one.
POSITION_ID = "0x" + "00" * 31 + "01"

REGISTRIES = {
    "base-sepolia": "0x2FE4cCe316287505ce114101b9d58c1f56d8E910",
    "arbitrum-sepolia": "0xB7e37E396bBB785c346D1909231a9B3D2707Cd32",
    "sepolia": "0xA5dCB9B329b17253FF35202dEb7a2093d06fd7b0",
}

REF_OF_SELECTOR = "0xf359606b"  # refOf(bytes32)
POKE_REF_SIG = "pokeRef(bytes32,(uint128,uint16,int16,uint40,uint32,uint128,int64,uint32,uint16,uint16))"

# Still hand-chosen, and still honest about it: the workflow that computes these lives on Day 5.
# Only `mid` and `updatedAt` are claimed to be measured here.
SPREAD_BPS = 10
TILT_BPS = 0

UINT128_MAX = 2**128 - 1


def read_ref(rpc_url: str, registry: str) -> dict:
    """ZentisRef is entirely static, so it returns as ten inline words — no head/tail offset."""
    data = REF_OF_SELECTOR + POSITION_ID[2:]
    raw = eth_call(rpc_url, registry, data, block_number_latest(rpc_url))
    words = [int(raw[2 + i * 64 : 2 + (i + 1) * 64], 16) for i in range(10)]
    return {"mid": words[0], "spreadBps": words[1], "updatedAt": words[3], "seq": words[4]}


def block_number_latest(rpc_url: str) -> int:
    from reference_model.onchain import block_number

    return block_number(rpc_url)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--send", action="store_true", help="broadcast; otherwise print only")
    args = ap.parse_args()

    now = int(time.time())
    legs = {}
    for name, cfg in CHAINS.items():
        leg = fetch_chain(name, cfg, now)
        leg["rpcUrl"] = cfg["rpc_url"]
        leg["registry"] = REGISTRIES[name]
        # The struct's `updatedAt` is "timestamp of the QUERIED block, not the write" — so it is the
        # pinned block's own timestamp, not the pool's last-trade timestamp (which fetch_live_mid
        # reports separately as a freshness signal and can be arbitrarily old on a quiet testnet).
        leg["pinnedTimestamp"] = block_timestamp(cfg["rpc_url"], leg["pinnedBlock"])
        leg["prev"] = read_ref(cfg["rpc_url"], REGISTRIES[name])
        legs[name] = leg

    # One `updatedAt` and one `seq` across both legs: the two refs describe a single cross-chain
    # instant, so the combined reference must be no fresher than its laggier leg, and a reader must
    # be able to tell "these two came from the same observation" by comparing seq.
    updated_at = min(leg["pinnedTimestamp"] for leg in legs.values())
    seq = max(leg["prev"]["seq"] for leg in legs.values()) + 1

    for name, leg in legs.items():
        prev = leg["prev"]
        if leg["mid"] == 0 or leg["mid"] > UINT128_MAX:
            raise SystemExit(f"{name}: mid {leg['mid']} is not a storable uint128")
        if updated_at < prev["updatedAt"]:
            raise SystemExit(
                f"{name}: updatedAt {updated_at} is older than the stored {prev['updatedAt']}; "
                "the registry would reject this write"
            )

        print(
            f"{name:>18} | registry {leg['registry']}\n"
            f"{'':>18} | pinned block {leg['pinnedBlock']} (ts {leg['pinnedTimestamp']})\n"
            f"{'':>18} | mid {prev['mid']} -> {leg['mid']}\n"
            f"{'':>18} | seq {prev['seq']} -> {seq} | updatedAt {prev['updatedAt']} -> {updated_at}"
        )

        ref_tuple = (
            f"({leg['mid']},{SPREAD_BPS},{TILT_BPS},{updated_at},{seq},0,0,0,0,0)"
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
            raise SystemExit(f"{name}: cast send failed:\n{result.stderr.replace(os.environ['WALLET_PRIVATE_KEY'], '<redacted>')}")
        tx = next((l.split()[-1] for l in result.stdout.splitlines() if l.startswith("transactionHash")), "?")
        print(f"{'':>18} | sent {tx}\n")


if __name__ == "__main__":
    main()
