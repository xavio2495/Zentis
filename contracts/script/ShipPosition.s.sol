// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {console2} from "forge-std/Script.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";

import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";

import {IZentisRef, ZentisRef} from "../src/ref/IZentisRef.sol";
import {ZentisRouter} from "../src/routers/ZentisRouter.sol";
import {ZentisScript} from "./ZentisScript.sol";

interface IWETH {
    function deposit() external payable;
}

/// @notice Ships one Zentis position to a live Aqua on one chain.
///
/// @dev The inventory split is NOT a parameter. `balanceB` is derived on-chain from the reference
///      mid the subgraph wrote, so the curve's implied rate equals the published reference at ship
///      time — which is what `ZentisBand` compares every fill against. Shipping a hand-picked split
///      would put the position outside its own band from the first block.
contract ShipPosition is ZentisScript {
    uint256 private constant ONE = 1e18;

    function run() external returns (bytes32 strategyHash) {
        uint256 makerKey = vm.envUint("WALLET_PRIVATE_KEY");
        address maker = vm.addr(makerKey);

        IAqua aqua = IAqua(vm.envAddress("AQUA"));
        ZentisRouter router = ZentisRouter(payable(vm.envAddress("ZENTIS_ROUTER")));
        address ref = vm.envAddress("REF_REGISTRY");
        address tokenA = vm.envAddress("TOKEN_A");
        address tokenB = vm.envAddress("TOKEN_B");
        uint256 balanceA = vm.envUint("BALANCE_A");

        ZentisRef memory r = IZentisRef(ref).refOf(vm.envBytes32("POSITION_ID"));
        require(r.mid != 0, "no reference published for this position");
        require(block.timestamp - r.updatedAt < 1 hours, "reference is already stale; re-poke first");

        // mid is raw tokenB per 1e18 raw tokenA, so this is the tokenB leg of the same rate.
        uint256 balanceB = (uint256(r.mid) * balanceA) / ONE;

        ISwapVM.Order memory order = _order(maker, ref, tokenA, tokenB);

        address[] memory tokens = new address[](2);
        tokens[0] = tokenA;
        tokens[1] = tokenB;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = balanceA;
        amounts[1] = balanceB;

        vm.startBroadcast(makerKey);
        uint256 heldB = IERC20(tokenB).balanceOf(maker);
        if (heldB < balanceB) IWETH(tokenB).deposit{value: balanceB - heldB}();
        IERC20(tokenA).approve(address(aqua), balanceA);
        IERC20(tokenB).approve(address(aqua), balanceB);
        strategyHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);
        vm.stopBroadcast();

        console2.log("maker          ", maker);
        console2.log("strategyHash   ", vm.toString(strategyHash));
        console2.log("orderHash      ", vm.toString(router.hash(order)));
        console2.log("reference mid  ", r.mid);
        console2.log("reference seq  ", r.seq);
        console2.log("balanceA (raw) ", balanceA);
        console2.log("balanceB (raw) ", balanceB);
    }
}
