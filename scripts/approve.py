#!/usr/bin/env python3
"""
Make sure Aqua can settle every fill: the maker's allowance to Aqua must cover what each leg has
committed, on both tokens.

Aqua holds no tokens. `ship()` and `push()` only record a balance; when a taker fills, Aqua
`pull()`s the maker's side with `safeTransferFrom(maker, taker, amount)` against the allowance the
maker gave Aqua. Shipping approves exactly the shipped amount, and a `push()` top-up is itself a
`safeTransferFrom` that consumes allowance, so after the 2026-09-11 top-ups the WETH allowance was
zero on Sepolia and Arbitrum and short on Base while the committed balances were intact. Every fill
in the direction that takes WETH from the maker would have reverted at settlement.

This script reads committed balances and allowances for both tokens on every leg and approves the
committed amount wherever the allowance is short. Approving exactly the commitment mirrors what
shipping does; anything a later `push()` adds is approved by `scripts/rebalance.py`, which now
sizes its approval to cover both the transfer and the settlement of what it commits.

    python3 scripts/approve.py            # read, print the plan, touch nothing
    python3 scripts/approve.py --send     # approve where short (the user runs this; it signs)
    python3 scripts/approve.py --send --only sepolia
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rebalance import RPCS, ROOT, call, key, next_nonce, send  # noqa: E402

TOKENS = (("tokenA", "USDC", 10**6), ("tokenB", "WETH", 10**18))


def leg_for(name, fast):
    record = json.loads((ROOT / "contracts" / "deployments" / f"{name}.json").read_text())
    wanted = record["position"]["strategyHash"].lower()
    for leg in fast["legs"]:
        if leg["strategyHash"].lower() == wanted:
            return leg
    return None


def plan_leg(name, rpc, fast):
    leg = leg_for(name, fast)
    if leg is None:
        return None, f"{name}: the deployment's strategy hash is in no fast-workflow leg"
    maker = fast["maker"]
    balances = call(leg["aqua"], "safeBalances(address,address,bytes32,address,address)(uint256,uint256)",
                    maker, leg["app"], leg["strategyHash"], leg["tokenA"], leg["tokenB"], rpc=rpc)
    if balances is None:
        return None, f"{name}: the balance read reverted, so this leg is not active"
    rows = []
    for (field, symbol, unit), committed in zip(TOKENS, balances):
        token = leg[field]
        allowance = call(token, "allowance(address,address)(uint256)", maker, leg["aqua"], rpc=rpc)[0]
        rows.append({"field": field, "symbol": symbol, "unit": unit, "token": token,
                     "committed": committed, "allowance": allowance,
                     "short": max(0, committed - allowance)})
    return {"name": name, "rpc": rpc, "leg": leg, "maker": maker, "rows": rows}, None


def main():
    sending = "--send" in sys.argv
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    fast = json.loads((ROOT / "cre/fast/config.staging.json").read_text())
    private_key = key() if sending else None
    short_anywhere = False

    for name, rpc in RPCS.items():
        if only and name != only:
            continue
        plan, problem = plan_leg(name, rpc, fast)
        if problem:
            print(problem)
            continue
        print(f"== {name}")
        nonce = None
        for row in plan["rows"]:
            fmt = lambda raw: f"{raw / row['unit']:.6f} {row['symbol']}"
            state = f"committed {fmt(row['committed'])}, allowance {fmt(row['allowance'])}"
            if row["short"] == 0:
                print(f"   {row['symbol']}: {state}; settlement covered")
                continue
            short_anywhere = True
            # Aqua pulls the fill amount, not the commitment, so only a fill larger than what is still
            # allowed reverts; the invariant kept here is allowance >= committed, because shipping
            # approves exactly the commitment and nothing else ever tops it up.
            print(f"   {row['symbol']}: {state}; SHORT by {fmt(row['short'])}, a fill taking more than "
                  f"{fmt(row['allowance'])} from the maker reverts at settlement")
            if not sending:
                print(f"      would approve Aqua for {fmt(row['committed'])}")
                continue
            if nonce is None:
                nonce = next_nonce(plan["maker"], rpc)
            else:
                nonce += 1
            receipt, error = send(row["token"], "approve(address,uint256)", plan["leg"]["aqua"], row["committed"],
                                  rpc=rpc, private_key=private_key, nonce=nonce)
            if error:
                print(f"      approve FAILED: {error}")
                continue
            print(f"      approved {fmt(row['committed'])}: {receipt['transactionHash']} status {receipt['status']}")

    if short_anywhere and not sending:
        print("\nnothing sent; run with --send to approve")


if __name__ == "__main__":
    main()
