// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.30;

import {console2} from "forge-std/Script.sol";

import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {MakerTraits} from "swap-vm/libs/MakerTraits.sol";
import {TakerTraitsLib} from "swap-vm/libs/TakerTraits.sol";

import {ZentisRouter} from "../src/routers/ZentisRouter.sol";
import {ZentisScript} from "./ZentisScript.sol";

/// @title EncodeFill
/// @notice Prints everything a fill needs as bytes, so a standalone console can hand them to `cast`
///         without re-implementing the order or the taker-traits builders.
/// @dev The compiled console must not depend on this repository, but the five rules forbid it
///      guessing an encoding either. The way out is that the vetted Solidity builders run once,
///      here, and their output is recorded beside the deployment: the order as the tuple `swap()`
///      takes, and the taker traits for the recorded taker in both directions (they do not depend
///      on the amount). `swap(order, amount, takerData)` is then one `cast send`.
///
///      The order hash the router computes is printed too. The recorder refuses to write anything
///      whose hash is not the shipped strategyHash, which is the whole proof that these bytes are
///      the position that is live and not a builder run against drifted config. No broadcast; the
///      only chain call is the router's `hash()` view.
contract EncodeFill is ZentisScript {
    function run() external {
        ZentisRouter router = ZentisRouter(payable(vm.envAddress("ZENTIS_ROUTER")));
        address maker = vm.envAddress("MAKER");
        address ref = vm.envAddress("REF_REGISTRY");
        address tokenA = vm.envAddress("TOKEN_A");
        address tokenB = vm.envAddress("TOKEN_B");
        address taker = vm.envAddress("TAKER_ADDRESS");

        ISwapVM.Order memory order = _order(maker, ref, tokenA, tokenB);
        bytes32 orderHash = router.hash(order);

        TakerTraitsLib.Args memory t;
        t.taker = taker;
        t.isExactIn = true;
        t.isFirstTransferFromTaker = true;
        t.useTransferFromAndAquaPush = true;
        t.isAToB = true;
        bytes memory takerAToB = TakerTraitsLib.build(t);
        t.isAToB = false;
        bytes memory takerBToA = TakerTraitsLib.build(t);

        // One value per line, labelled, so the recorder parses by label and never by position.
        console2.log("orderHash", vm.toString(orderHash));
        console2.log("orderMaker", vm.toString(order.maker));
        console2.log("orderTraits", vm.toString(MakerTraits.unwrap(order.traits)));
        console2.log("orderData", vm.toString(order.data));
        console2.log("takerAToB", vm.toString(takerAToB));
        console2.log("takerBToA", vm.toString(takerBToA));
        console2.log("taker", vm.toString(taker));
        console2.log("swapSignature", "swap((address,uint256,bytes),uint256,bytes)");
    }
}
