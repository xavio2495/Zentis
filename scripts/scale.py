#!/usr/bin/env python3
"""
Grow every leg to a chosen size, on the mid, without a re-ship.

Aqua `push()` adds inventory to a live strategy: no dock, no new strategyHash, the fills history
kept. This pushes both sides of each leg up to a target — tokenA to the amount asked for, tokenB to
what the published mid says matches it — so the leg grows without changing its lean. WETH is
wrapped from the maker's gas balance when the wallet is short; USDC has to be in the wallet already
(testnet USDC comes from a faucet, not from ETH), and the script says how much is missing rather
than pushing a smaller leg silently.

Allowances have two jobs (the lesson of 2026-09-11): `push()` is a `safeTransferFrom` that consumes
allowance now, and every later fill is settled by Aqua pulling against what is left. So each token
is approved for the push plus the whole commitment that results.

Only adds. A leg already above the target on a side is left as it is on that side.

    python3 scripts/scale.py --usdc 35            # dry run: print what each leg would receive
    python3 scripts/scale.py --usdc 35 --send     # wrap, approve, push (the user runs this; it signs)
    python3 scripts/scale.py --usdc 35 --send --only sepolia
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rebalance import ONE, ROOT, RPCS, call, key, next_nonce, send  # noqa: E402
import txlog  # noqa: E402

CHAIN_IDS = {"sepolia": 11155111, "arbitrum-sepolia": 421614, "base-sepolia": 84532}
GAS_RESERVE_WEI = 2 * 10**17   # keep 0.2 ETH for gas on every chain, whatever is wrapped


def arg(name: str, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def plan_leg(name: str, rpc: str, fast: dict, target_a: int) -> tuple[dict | None, str | None]:
    record = json.loads((ROOT / "contracts" / "deployments" / f"{name}.json").read_text())
    position = record["position"]
    legs = [l for l in fast["legs"] if l["strategyHash"].lower() == position["strategyHash"].lower()]
    if not legs:
        return None, f"{name}: the deployment's strategy hash is in no fast-workflow leg"
    leg = legs[0]
    maker = fast["maker"]
    ref = call(leg["registry"], "refOf(bytes32)(uint256,uint16,int16,uint40,uint32,uint256,int256,uint16,uint16,uint16)",
               fast["positionId"], rpc=rpc)
    if ref is None or ref[0] == 0:
        return None, f"{name}: no reference published, so there is no mid to size against"
    mid = ref[0]
    balances = call(leg["aqua"], "safeBalances(address,address,bytes32,address,address)(uint256,uint256)",
                    maker, leg["app"], leg["strategyHash"], leg["tokenA"], leg["tokenB"], rpc=rpc)
    if balances is None:
        return None, f"{name}: the balance read reverted, so this leg is not active"
    balance_a, balance_b = balances
    target_b = target_a * mid // ONE
    push_a = max(0, target_a - balance_a)
    push_b = max(0, target_b - balance_b)
    held_a = call(leg["tokenA"], "balanceOf(address)(uint256)", maker, rpc=rpc)[0]
    held_b = call(leg["tokenB"], "balanceOf(address)(uint256)", maker, rpc=rpc)[0]
    gas = call(leg["tokenB"], "balanceOf(address)(uint256)", maker, rpc=rpc) and int(
        __import__("subprocess").run(["cast", "balance", maker, "-r", rpc], capture_output=True, text=True).stdout.split()[0])
    # Free is what the wallet holds beyond what this leg already committed: Aqua pulls the
    # commitment from the same wallet at settlement, so committed tokens are spoken for.
    free_a = max(0, held_a - balance_a)
    free_b = max(0, held_b - balance_b)
    short_a = max(0, push_a - free_a)
    wrap = max(0, push_b - free_b)
    wrap_short = max(0, wrap - max(0, gas - GAS_RESERVE_WEI))
    allowance_a = call(leg["tokenA"], "allowance(address,address)(uint256)", maker, leg["aqua"], rpc=rpc)[0]
    allowance_b = call(leg["tokenB"], "allowance(address,address)(uint256)", maker, leg["aqua"], rpc=rpc)[0]
    return {
        "name": name, "rpc": rpc, "leg": leg, "maker": maker, "mid": mid,
        "balanceA": balance_a, "balanceB": balance_b, "targetA": target_a, "targetB": target_b,
        "pushA": push_a, "pushB": push_b, "wrap": wrap, "shortA": short_a, "wrapShort": wrap_short,
        # allowance must cover this push now and the whole commitment that results
        "approveA": push_a + (balance_a + push_a) if allowance_a < push_a + balance_a + push_a else 0,
        "approveB": push_b + (balance_b + push_b) if allowance_b < push_b + balance_b + push_b else 0,
    }, None


def main() -> None:
    sending = "--send" in sys.argv
    only = arg("--only")
    usdc = arg("--usdc")
    if usdc is None:
        sys.exit("say how big each leg should be: --usdc <USDC per leg>")
    target_a = int(round(float(usdc) * 1e6))
    fast = json.loads((ROOT / "cre/fast/config.staging.json").read_text())
    private_key = key() if sending else None

    for name, rpc in RPCS.items():
        if only and name != only:
            continue
        plan, problem = plan_leg(name, rpc, fast, target_a)
        if problem:
            print(problem)
            continue
        leg = plan["leg"]
        usd = 1e30 / plan["mid"]
        print(f"== {name}: mid 1 WETH = {usd:,.0f} USDC")
        print(f"   holds {plan['balanceA'] / 1e6:.2f} USDC · {plan['balanceB'] / 1e18:.6f} WETH → "
              f"target {plan['targetA'] / 1e6:.2f} USDC · {plan['targetB'] / 1e18:.6f} WETH")
        if plan["pushA"] == 0 and plan["pushB"] == 0:
            print("   already at or above the target on both sides; nothing to push")
            continue
        print(f"   push {plan['pushA'] / 1e6:.2f} USDC and {plan['pushB'] / 1e18:.6f} WETH"
              + (f", wrapping {plan['wrap'] / 1e18:.6f} ETH" if plan["wrap"] else ""))
        if plan["shortA"]:
            print(f"   BLOCKED: the wallet is {plan['shortA'] / 1e6:.2f} USDC short of this target; fund it from a faucet first")
            continue
        if plan["wrapShort"]:
            print(f"   BLOCKED: wrapping would leave less than {GAS_RESERVE_WEI / 1e18} ETH for gas ({plan['wrapShort'] / 1e18:.4f} short)")
            continue
        if not sending:
            continue
        nonce = next_nonce(plan["maker"], rpc)
        steps = []
        if plan["wrap"]:
            steps.append(("wrap", leg["tokenB"], "deposit()", (), {"value": plan["wrap"]}, plan["wrap"], leg["tokenB"]))
        if plan["approveA"]:
            steps.append(("approve", leg["tokenA"], "approve(address,uint256)", (leg["aqua"], plan["approveA"]), {}, plan["approveA"], leg["tokenA"]))
        if plan["approveB"]:
            steps.append(("approve", leg["tokenB"], "approve(address,uint256)", (leg["aqua"], plan["approveB"]), {}, plan["approveB"], leg["tokenB"]))
        if plan["pushA"]:
            steps.append(("push", leg["aqua"], "push(address,address,bytes32,address,uint256)",
                          (plan["maker"], leg["app"], leg["strategyHash"], leg["tokenA"], plan["pushA"]), {}, plan["pushA"], leg["tokenA"]))
        if plan["pushB"]:
            steps.append(("push", leg["aqua"], "push(address,address,bytes32,address,uint256)",
                          (plan["maker"], leg["app"], leg["strategyHash"], leg["tokenB"], plan["pushB"]), {}, plan["pushB"], leg["tokenB"]))
        failed = False
        for kind, to, sig, args, extra, amount, token in steps:
            receipt, error = send(to, sig, *args, rpc=rpc, private_key=private_key, nonce=nonce, **extra)
            if error:
                print(f"   {kind} FAILED: {error}")
                txlog.record(name, CHAIN_IDS[name], kind, plan["maker"], status=0, amount_in=amount, token_in=token, note=error[-200:])
                failed = True
                break
            status = int(receipt["status"], 16)
            print(f"   {kind} {amount}: {receipt['transactionHash']} status {status}")
            txlog.record(name, CHAIN_IDS[name], kind, plan["maker"], tx=receipt["transactionHash"], status=status,
                         amount_in=amount, token_in=token, note=f"scale leg to {usdc} USDC on the mid")
            nonce += 1
        if not failed:
            print(f"   done; the workflow sees the new balances once the push blocks are final (~20 min)")


if __name__ == "__main__":
    main()
