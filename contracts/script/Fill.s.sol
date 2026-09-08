// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {console2} from "forge-std/Script.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {TakerTraitsLib} from "swap-vm/libs/TakerTraits.sol";

import {ZentisRouter} from "../src/routers/ZentisRouter.sol";
import {ZentisScript} from "./ZentisScript.sol";

/// @notice Takes the other side of a live Zentis position: an ordinary EOA, a token approval to the
///         router, one `swap()`. `useTransferFromAndAquaPush` is what makes an EOA taker possible —
///         the router pulls tokenIn and pushes it into Aqua on the taker's behalf, so no taker
///         callback contract is involved.
contract Fill is ZentisScript {
    function run() external returns (uint256 amountIn, uint256 amountOut) {
        uint256 takerKey = vm.envUint("TAKER_PRIVATE_KEY");
        address taker = vm.addr(takerKey);

        ZentisRouter router = ZentisRouter(payable(vm.envAddress("ZENTIS_ROUTER")));
        address maker = vm.envAddress("MAKER");
        address ref = vm.envAddress("REF_REGISTRY");
        address tokenA = vm.envAddress("TOKEN_A");
        address tokenB = vm.envAddress("TOKEN_B");

        bool isAToB = vm.envBool("FILL_A_TO_B");
        uint256 amount = vm.envUint("FILL_AMOUNT");
        address tokenIn = isAToB ? tokenA : tokenB;

        ISwapVM.Order memory order = _order(maker, ref, tokenA, tokenB);

        TakerTraitsLib.Args memory t;
        t.taker = taker;
        t.isExactIn = true;
        t.isAToB = isAToB;
        t.isFirstTransferFromTaker = true;
        t.useTransferFromAndAquaPush = true;
        bytes memory takerData = TakerTraitsLib.build(t);

        (uint256 quotedIn, uint256 quotedOut,) = router.asView().quote(order, amount, takerData);
        console2.log("quoted in      ", quotedIn);
        console2.log("quoted out     ", quotedOut);

        vm.startBroadcast(takerKey);
        IERC20(tokenIn).approve(address(router), amount);
        (amountIn, amountOut,) = router.swap(order, amount, takerData);
        vm.stopBroadcast();

        console2.log("taker          ", taker);
        console2.log("filled in      ", amountIn);
        console2.log("filled out     ", amountOut);
        require(amountIn == quotedIn && amountOut == quotedOut, "quote/swap parity broken on-chain");
    }
}
