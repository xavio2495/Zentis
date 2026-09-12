#!/usr/bin/env python3
"""
Top the taker up from the maker on every chain, so the headless taker can keep filling a bigger book.

The taker needs three things per chain: USDC to buy WETH with, WETH to sell back, and ETH for gas.
The maker has all three (USDC from the faucet, ETH from the faucet, WETH by wrapping), so this moves
a stated amount of each from the maker to the taker: transfer USDC, wrap ETH and transfer the WETH,
send ETH. Signs with CRE_ETH_PRIVATE_KEY from ~/.zentis/cre.env; never prints it.

    python3 scripts/fund_taker.py --usdc 10 --weth 0.01 --eth 0.05            # dry run
    python3 scripts/fund_taker.py --usdc 10 --weth 0.01 --eth 0.05 --send     # the user runs this
    python3 scripts/fund_taker.py ... --only sepolia
"""
import json, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rebalance import ROOT, RPCS, call, key, next_nonce, send  # noqa: E402
import txlog  # noqa: E402

CHAIN_IDS = {"sepolia": 11155111, "arbitrum-sepolia": 421614, "base-sepolia": 84532}
GAS_RESERVE_WEI = 2 * 10**17


def arg(name: str, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def taker_address() -> str:
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("TAKER_ADDRESS="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("no TAKER_ADDRESS in the root .env")


def main() -> None:
    sending = "--send" in sys.argv
    only = arg("--only")
    usdc = int(round(float(arg("--usdc", "0")) * 1e6))
    weth = int(round(float(arg("--weth", "0")) * 1e18))
    eth = int(round(float(arg("--eth", "0")) * 1e18))
    if not (usdc or weth or eth):
        sys.exit("say what to send: --usdc N --weth N --eth N")
    fast = json.loads((ROOT / "cre/fast/config.staging.json").read_text())
    maker, taker = fast["maker"], taker_address()
    private_key = key() if sending else None

    for name, rpc in RPCS.items():
        if only and name != only:
            continue
        record = json.loads((ROOT / "contracts" / "deployments" / f"{name}.json").read_text())
        token_a, token_b = record["tokens"]["tokenA"]["address"], record["tokens"]["tokenB"]["address"]
        held_a = call(token_a, "balanceOf(address)(uint256)", maker, rpc=rpc)[0]
        held_b = call(token_b, "balanceOf(address)(uint256)", maker, rpc=rpc)[0]
        gas = int(subprocess.run(["cast", "balance", maker, "-r", rpc], capture_output=True, text=True).stdout.split()[0])
        leg = next((l for l in fast["legs"] if l["strategyHash"].lower() == record["position"]["strategyHash"].lower()), None)
        committed = call(leg["aqua"], "safeBalances(address,address,bytes32,address,address)(uint256,uint256)",
                         maker, leg["app"], leg["strategyHash"], token_a, token_b, rpc=rpc) if leg else (0, 0)
        free_a, free_b = max(0, held_a - committed[0]), max(0, held_b - committed[1])
        wrap = max(0, weth - free_b)
        need_eth = wrap + eth + GAS_RESERVE_WEI
        print(f"== {name}: maker free {free_a / 1e6:.2f} USDC, {free_b / 1e18:.6f} WETH, {gas / 1e18:.4f} ETH")
        problems = []
        if usdc > free_a:
            problems.append(f"{(usdc - free_a) / 1e6:.2f} USDC short (committed inventory is not free)")
        if need_eth > gas:
            problems.append(f"{(need_eth - gas) / 1e18:.4f} ETH short after the {GAS_RESERVE_WEI / 1e18} reserve")
        if problems:
            print("   BLOCKED: " + "; ".join(problems))
            continue
        print(f"   send {usdc / 1e6:.2f} USDC, {weth / 1e18:.6f} WETH (wrapping {wrap / 1e18:.6f}), {eth / 1e18:.4f} ETH to {taker[:10]}…")
        if not sending:
            continue
        nonce = next_nonce(maker, rpc)
        steps = []
        if usdc:
            steps.append(("transfer", token_a, "transfer(address,uint256)", (taker, usdc), {}, usdc, token_a))
        if wrap:
            steps.append(("wrap", token_b, "deposit()", (), {"value": wrap}, wrap, token_b))
        if weth:
            steps.append(("transfer", token_b, "transfer(address,uint256)", (taker, weth), {}, weth, token_b))
        if eth:
            steps.append(("transfer", taker, None, (), {"value": eth}, eth, "ETH"))
        for kind, to, sig, args, extra, amount, token in steps:
            if sig is None:
                out = subprocess.run(["cast", "send", to, "--value", str(amount), "--private-key", private_key, "-r", rpc,
                                      "--nonce", str(nonce), "--json"], capture_output=True, text=True)
                receipt, error = (json.loads(out.stdout), None) if out.returncode == 0 else (None, out.stderr.strip()[-300:])
            else:
                receipt, error = send(to, sig, *args, rpc=rpc, private_key=private_key, nonce=nonce, **extra)
            if error:
                print(f"   {kind} FAILED: {error}")
                txlog.record(name, CHAIN_IDS[name], kind, maker, status=0, amount_in=amount, token_in=token, note=error[-200:])
                break
            status = int(receipt["status"], 16)
            print(f"   {kind} {amount} {token[:10]}: {receipt['transactionHash']} status {status}")
            txlog.record(name, CHAIN_IDS[name], kind, maker, tx=receipt["transactionHash"], status=status,
                         amount_in=amount, token_in=token, note="fund the taker from the maker")
            nonce += 1


if __name__ == "__main__":
    main()
