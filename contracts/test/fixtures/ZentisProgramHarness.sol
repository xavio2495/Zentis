// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CalldataPtrLib} from "@1inch/solidity-utils/contracts/libraries/CalldataPtr.sol";

import {Context, ContextLib} from "swap-vm/libs/VM.sol";

import {ZentisOpcodes} from "../../src/opcodes/ZentisOpcodes.sol";

/// @notice Runs a real Zentis program through the real runLoop, with the real opcode table wired in
///         as the dispatcher — the same path production takes, minus Aqua's settlement layer (which
///         only preloads the balance registers, and which the end-to-end Day 4 tests cover).
///         Wrapper instructions (ZentisSpread, ZentisBand) can only be exercised this way: they call
///         ctx.runLoop() to execute the rest of the program, so a hand-built Context is not enough.
contract ZentisProgramHarness is ZentisOpcodes {
    using ContextLib for Context;

    struct Setup {
        uint256 balanceIn;
        uint256 balanceOut;
        uint256 amount; // amountIn when isExactIn, else amountOut
        bool isExactIn;
        address tokenIn;
        address tokenOut;
    }

    function run(bytes calldata program, Setup memory s)
        external
        returns (uint256 amountIn, uint256 amountOut)
    {
        return _run(program, msg.data[0:0], s);
    }

    /// @notice Same, but with taker-supplied instruction args — where the optional seq pin lives.
    function runWithTakerArgs(bytes calldata program, bytes calldata takerArgs, Setup memory s)
        external
        returns (uint256 amountIn, uint256 amountOut)
    {
        return _run(program, takerArgs, s);
    }

    function _run(bytes calldata program, bytes calldata takerArgs, Setup memory s)
        private
        returns (uint256 amountIn, uint256 amountOut)
    {
        Context memory ctx;
        ctx.vm.programPtr = CalldataPtrLib.from(program);
        ctx.vm.takerArgsPtr = CalldataPtrLib.from(takerArgs);
        ctx.vm.dispatch = _runOpcode;

        ctx.query.tokenIn = s.tokenIn;
        ctx.query.tokenOut = s.tokenOut;
        ctx.query.isExactIn = s.isExactIn;

        ctx.swap.balanceIn = s.balanceIn;
        ctx.swap.balanceOut = s.balanceOut;
        if (s.isExactIn) ctx.swap.amountIn = s.amount;
        else ctx.swap.amountOut = s.amount;

        return ctx.runLoop();
    }
}
