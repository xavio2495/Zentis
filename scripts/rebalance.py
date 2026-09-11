#!/usr/bin/env python3
"""
Put each leg's curve back on the published mid by topping it up, with no dock and no re-ship.

This is the maker rebalancing by adding inventory rather than by trading, which is the move the
product has always claimed and `push()` is the Aqua call for it. A constant-product leg prices at
balanceA/balanceB; when the reference mid moves away from that, the correction term of the shift
tries to close the gap and is bounded by the signed cap. Past the cap the leg pins and the band
starts refusing one direction. Topping up the short side closes the gap at its source.

Why not re-ship: Aqua burns a strategyHash permanently. `ship()` requires the recorded token count
to be zero and `dock()` sets it to 0xff, so an identical order can never be shipped twice
(`StrategiesMustBeImmutable`). Re-shipping therefore needs a changed order parameter — a bumped
deadline would do it — and costs a new strategyHash, new config entries and a new generation in
every record. A top-up keeps the live strategy, its history and its fills.

Only adds. A leg holding too much of a side cannot be fixed this way, and the script says so
rather than doing half of it.

    python3 scripts/rebalance.py --dry-run   # read the state, print the top-ups, touch nothing
    python3 scripts/rebalance.py             # wrap if short, approve, push
    python3 scripts/rebalance.py --only sepolia
"""
import json, os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ONE = 10**18
RPCS = {
    "sepolia": "https://ethereum-sepolia-rpc.publicnode.com",
    "arbitrum-sepolia": "https://sepolia-rollup.arbitrum.io/rpc",
    "base-sepolia": "https://sepolia.base.org",
}


def key() -> str:
    env = Path(os.environ.get("ZENTIS_CRE_ENV", Path.home() / ".zentis" / "cre.env"))
    for line in env.read_text().splitlines():
        if line.startswith("CRE_ETH_PRIVATE_KEY="):
            k = line.split("=", 1)[1].strip().strip('"')
            return k if k.startswith("0x") else "0x" + k
    sys.exit(f"no CRE_ETH_PRIVATE_KEY in {env}")


def call(to, sig, *args, rpc):
    out = subprocess.run(["cast", "call", to, sig, *map(str, args), "-r", rpc], capture_output=True, text=True)
    if out.returncode != 0:
        return None
    return [int(line.split()[0]) for line in out.stdout.strip().splitlines()]


def send(to, sig, *args, rpc, private_key, value=None, nonce=None):
    """One transaction, with the nonce stated rather than inferred.

    `cast send` waits for a receipt, but some testnet RPCs answer with the receipt before their own
    pending-nonce view has caught up, so a second send moments later picks the same nonce and is
    refused as an underpriced replacement. That is how the Base leg's approve died between its wrap
    and its push. Counting the nonce here removes the race rather than sleeping through it.
    """
    cmd = ["cast", "send", to, sig, *map(str, args), "--private-key", private_key, "-r", rpc, "--json"]
    if value is not None:
        cmd += ["--value", str(value)]
    if nonce is not None:
        cmd += ["--nonce", str(nonce)]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        return None, out.stderr.strip()[-400:]
    return json.loads(out.stdout), None


def next_nonce(address, rpc):
    out = subprocess.run(["cast", "nonce", address, "--block", "pending", "-r", rpc], capture_output=True, text=True)
    return int(out.stdout.strip()) if out.returncode == 0 else None


def plan_leg(name, rpc, fast):
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
        return None, f"{name}: no reference published, so there is no mid to put the curve on"
    mid = ref[0]

    balances = call(leg["aqua"], "safeBalances(address,address,bytes32,address,address)(uint256,uint256)",
                    maker, leg["app"], leg["strategyHash"], leg["tokenA"], leg["tokenB"], rpc=rpc)
    if balances is None:
        return None, f"{name}: the balance read reverted, so this leg is not active"
    balance_a, balance_b = balances

    # balanceA/balanceB must equal the mid's rate: wanted_b = balanceA * mid / 1e18, in raw tokenB.
    wanted_b = balance_a * mid // ONE
    top_up = wanted_b - balance_b
    held = call(leg["tokenB"], "balanceOf(address)(uint256)", maker, rpc=rpc)[0]
    committed = balance_b
    free = max(0, held - committed)
    # Shipping approves Aqua for the leg's whole tokenB side and ship() moves nothing, so that
    # allowance is usually still standing and large enough. Approving again costs a transaction and
    # an extra nonce for no effect.
    allowance = call(leg["tokenB"], "allowance(address,address)(uint256)", maker, leg["aqua"], rpc=rpc)[0]
    return {
        "name": name, "rpc": rpc, "leg": leg, "maker": maker,
        "mid": mid, "balanceA": balance_a, "balanceB": balance_b,
        "wantedB": wanted_b, "topUp": top_up, "free": free, "wrap": max(0, top_up - free),
        "allowance": allowance,
    }, None


def main():
    dry_run = "--dry-run" in sys.argv
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    fast = json.loads((ROOT / "cre/fast/config.staging.json").read_text())
    private_key = None if dry_run else key()

    for name, rpc in RPCS.items():
        if only and name != only:
            continue
        plan, problem = plan_leg(name, rpc, fast)
        if problem:
            print(problem)
            continue
        curve = (plan["balanceA"] / 1e6) / (plan["balanceB"] / 1e18)
        target = 1e30 / plan["mid"]
        print(f"== {name}: curve 1 WETH = {curve:,.0f} USDC, mid {target:,.0f} USDC")
        if plan["topUp"] <= 0:
            print(f"   holds {-plan['topUp'] / 1e18:.6f} WETH more than the mid wants; a top-up cannot fix that, skipping")
            continue
        approving = "approving" if plan["allowance"] < plan["topUp"] else "allowance already covers it"
        print(f"   top up {plan['topUp'] / 1e18:.6f} WETH (free {plan['free'] / 1e18:.6f}, "
              f"wrapping {plan['wrap'] / 1e18:.6f}, {approving})")
        if dry_run:
            continue

        leg = plan["leg"]
        nonce = next_nonce(plan["maker"], rpc)
        if nonce is None:
            print("   could not read the maker's nonce, so nothing was sent")
            continue
        if plan["wrap"] > 0:
            receipt, error = send(leg["tokenB"], "deposit()", rpc=rpc, private_key=private_key,
                                  value=plan["wrap"], nonce=nonce)
            if error:
                print(f"   wrap FAILED: {error}")
                continue
            print(f"   wrapped: {receipt['transactionHash']}")
            nonce += 1
        if plan["allowance"] < plan["topUp"]:
            receipt, error = send(leg["tokenB"], "approve(address,uint256)", leg["aqua"], plan["topUp"],
                                  rpc=rpc, private_key=private_key, nonce=nonce)
            if error:
                print(f"   approve FAILED: {error}")
                continue
            print(f"   approved: {receipt['transactionHash']}")
            nonce += 1
        receipt, error = send(leg["aqua"], "push(address,address,bytes32,address,uint256)",
                              plan["maker"], leg["app"], leg["strategyHash"], leg["tokenB"], plan["topUp"],
                              rpc=rpc, private_key=private_key, nonce=nonce)
        if error:
            print(f"   push FAILED: {error}")
            continue
        print(f"   pushed: {receipt['transactionHash']} status {receipt['status']}")


if __name__ == "__main__":
    main()
