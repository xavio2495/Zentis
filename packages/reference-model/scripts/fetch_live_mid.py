#!/usr/bin/env python3
"""Day 2, tasks 2.1-2.3: pull live reserves from both chains, timestamp-aligned, and compute a
first `mid` and `x` — a script, not a workflow (that comes Day 5).

Pinned to `t = now - BUFFER_SECONDS` on each chain independently (task 2.2's indexing-lag buffer),
then takes the highest block on each chain with `timestamp <= t`. `updatedAt` is the min of the two
picked block timestamps, so the combined reference is never fresher than its laggier leg.

Reads Uniswap v3 WETH/USDC pools directly by RPC — see reference_model/onchain.py's docstring for
why this isn't a Graph query yet.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.onchain import (
    erc20_balance_of,
    highest_block_at_or_before,
    block_timestamp,
    mid_from_sqrt_price_x96,
    pool_sqrt_price_x96,
)

BUFFER_SECONDS = 30

# WETH/USDC, 0.3% fee tier — the tier with real, comparable liquidity on both testnets (checked
# on-chain 2026-09-06; the 0.05% tier is far thinner on Arbitrum Sepolia). USDC is token0 (the
# lower address) on both chains, so tokenA = USDC, tokenB = WETH throughout.
CHAINS = {
    "base-sepolia": {
        "rpc_url": "https://sepolia.base.org",
        "pool": "0x46880b404CD35c165EDdefF7421019F8dD25F4Ad",
        "token_a": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",  # USDC
        "token_b": "0x4200000000000000000000000000000000000006",  # WETH
    },
    "arbitrum-sepolia": {
        "rpc_url": "https://sepolia-rollup.arbitrum.io/rpc",
        "pool": "0x66EEAB70aC52459Dd74C6AD50D578Ef76a441bbf",
        "token_a": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",  # USDC
        "token_b": "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73",  # WETH
    },
}


def fetch_chain(name: str, cfg: dict, now: int) -> dict:
    rpc_url = cfg["rpc_url"]
    target = now - BUFFER_SECONDS
    block_num = highest_block_at_or_before(rpc_url, target)
    ts = block_timestamp(rpc_url, block_num)

    sqrt_price_x96 = pool_sqrt_price_x96(rpc_url, cfg["pool"], block_num)
    mid = mid_from_sqrt_price_x96(sqrt_price_x96)

    reserve_a = erc20_balance_of(rpc_url, cfg["token_a"], cfg["pool"], block_num)
    reserve_b = erc20_balance_of(rpc_url, cfg["token_b"], cfg["pool"], block_num)

    # x: imbalance signed relative to token A, positive = over-weight A. This is a *placeholder*
    # proxy computed from the pool's own composition (there is no real Zentis position yet — that's
    # Day 4) — the value-weighted difference between the pool's actual tokenA holdings and what it
    # would hold if split evenly with tokenB at the current mid.
    reserve_b_in_a_terms = (reserve_b * 10**18) // mid
    x = reserve_a - reserve_b_in_a_terms

    return {
        "chain": name,
        "blockNumber": block_num,
        "updatedAt": ts,
        "mid": mid,
        "reserveA": reserve_a,
        "reserveB": reserve_b,
        "x": x,
    }


def main() -> None:
    import time

    now = int(time.time())
    results = {name: fetch_chain(name, cfg, now) for name, cfg in CHAINS.items()}
    combined_updated_at = min(r["updatedAt"] for r in results.values())

    for r in results.values():
        print(
            f"{r['chain']:>18} | block {r['blockNumber']} | updatedAt {r['updatedAt']} | "
            f"mid {r['mid']} | reserveA {r['reserveA']} | reserveB {r['reserveB']} | x {r['x']}"
        )
    print(f"combined updatedAt (min across chains): {combined_updated_at}")


if __name__ == "__main__":
    main()
