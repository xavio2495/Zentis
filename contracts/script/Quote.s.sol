// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {console2} from "forge-std/Script.sol";

import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {TakerTraitsLib} from "swap-vm/libs/TakerTraits.sol";

import {IZentisRef, ZentisRef} from "../src/ref/IZentisRef.sol";
import {ZentisRouter} from "../src/routers/ZentisRouter.sol";
import {ZentisScript} from "./ZentisScript.sol";

/// @notice Read-only: what one leg would pay right now, and the reference it is pricing against.
///         Broadcasts nothing. The quote is a function of time as well as of state — the staleness
///         ramp widens it as the reference ages — so this reports the reference's age alongside it.
contract Quote is ZentisScript {
    function run() external returns (uint256 amountIn, uint256 amountOut) {
        ZentisRouter router = ZentisRouter(payable(vm.envAddress("ZENTIS_ROUTER")));
        address ref = vm.envAddress("REF_REGISTRY");
        ISwapVM.Order memory order =
            _order(vm.envAddress("MAKER"), ref, vm.envAddress("TOKEN_A"), vm.envAddress("TOKEN_B"));

        TakerTraitsLib.Args memory t;
        t.taker = vm.envAddress("MAKER");
        t.isExactIn = true;
        t.isAToB = vm.envBool("FILL_A_TO_B");
        t.isFirstTransferFromTaker = true;
        t.useTransferFromAndAquaPush = true;

        (amountIn, amountOut,) =
            router.asView().quote(order, vm.envUint("FILL_AMOUNT"), TakerTraitsLib.build(t));

        ZentisRef memory r = IZentisRef(ref).refOf(vm.envBytes32("POSITION_ID"));
        console2.log("amountIn       ", amountIn);
        console2.log("amountOut      ", amountOut);
        console2.log("ref mid        ", r.mid);
        console2.log("ref tiltBps    ", r.tiltBps);
        console2.log("ref seq        ", r.seq);
        console2.log("ref age (s)    ", block.timestamp - r.updatedAt);
    }
}
