// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Context} from "swap-vm/libs/VM.sol";
import {XYCSwap} from "swap-vm/instructions/XYCSwap.sol";

import {IZentisRef, ZentisRef} from "../../src/ref/IZentisRef.sol";
import {ZentisSkew} from "../../src/instructions/ZentisSkew.sol";

/// @notice Settable reference, so instruction tests can drive any ZentisRef without going through
///         ZentisRefRegistry's write guards (those have their own tests).
contract MockZentisRef is IZentisRef {
    ZentisRef private _ref;

    function set(ZentisRef calldata r) external {
        _ref = r;
    }

    function refOf(bytes32) external view returns (ZentisRef memory) {
        return _ref;
    }
}

/// @notice Drives ZentisSkew and XYCSwap against a hand-built Context. `exec` takes `bytes calldata`,
///         so the instruction has to be reached across an external call boundary.
contract ZentisSkewHarness {
    /// @return The balanceIn ZentisSkew leaves behind.
    function skewBalanceIn(
        uint256 balanceIn,
        uint256 balanceOut,
        address tokenIn,
        address tokenOut,
        bytes calldata args
    ) external view returns (uint256) {
        Context memory ctx;
        ctx.swap.balanceIn = balanceIn;
        ctx.swap.balanceOut = balanceOut;
        ctx.query.tokenIn = tokenIn;
        ctx.query.tokenOut = tokenOut;
        ZentisSkew.exec(ctx, args);
        return ctx.swap.balanceIn;
    }

    /// @return amountOut for an exact-in fill, after ZentisSkew then the curve — the full quote path.
    function skewThenXycExactIn(
        uint256 balanceIn,
        uint256 balanceOut,
        uint256 amountIn,
        address tokenIn,
        address tokenOut,
        bytes calldata args
    ) external view returns (uint256) {
        Context memory ctx;
        ctx.swap.balanceIn = balanceIn;
        ctx.swap.balanceOut = balanceOut;
        ctx.query.tokenIn = tokenIn;
        ctx.query.tokenOut = tokenOut;
        ctx.query.isExactIn = true;
        ZentisSkew.exec(ctx, args);
        ctx.swap.amountIn = amountIn;
        XYCSwap.exec(ctx, msg.data[0:0]);
        return ctx.swap.amountOut;
    }

    /// @return amountOut for an exact-in fill on the bare curve — the control.
    function xycExactIn(uint256 balanceIn, uint256 balanceOut, uint256 amountIn) external view returns (uint256) {
        Context memory ctx;
        ctx.swap.balanceIn = balanceIn;
        ctx.swap.balanceOut = balanceOut;
        ctx.query.isExactIn = true;
        ctx.swap.amountIn = amountIn;
        XYCSwap.exec(ctx, msg.data[0:0]);
        return ctx.swap.amountOut;
    }
}
