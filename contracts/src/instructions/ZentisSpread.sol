// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd
/// @custom:modified-by Zentis, 2026 — new instruction library for the SwapVM runtime.

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Context, ContextLib} from "swap-vm/libs/VM.sol";
import {Opcode} from "swap-vm/libs/OpcodeList.sol";
import {MemoryPtr, MemoryPtrLib} from "swap-vm/libs/MemoryPtr.sol";
import {InstructionBuilder} from "swap-vm/libs/InstructionBuilder.sol";
import {InstructionArgs} from "swap-vm/libs/InstructionArgs.sol";

import {IZentisRef, ZentisRef} from "../ref/IZentisRef.sol";
import {ZentisTiltLib} from "../libs/ZentisTiltLib.sol";

/// @notice ZentisSpread opcode: the maker's half-spread — base, plus an adverse-selection markout
///         term, plus a soft-bound ramp as the outbound side approaches its floor — applied as a
///         dynamic fee. A wrapper; replaces FeeFlatIn in the program.
/// @dev Encoding: [address ref | bytes32 positionId | uint128 floorOutA | uint128 floorOutB |
///      uint16 maxWidenBps] — 86 bytes. Spread is a second degree of freedom that leaves balanceOut
///      untouched: shifting balanceOut to control spread would break the no-free-value invariant, a
///      fee cannot.
///
///      Two floors, not one: `balanceOut` is tokenA in one direction and tokenB in the other, and the
///      pair's two tokens do not share decimals (WETH 18dp against USDC 6dp). A single floor is
///      therefore only ever meaningful on one side — sized in WETH it sits ~1e5x above the whole USDC
///      balance and pins the spread at max on every USDC-out fill. Selecting by direction here costs
///      16 bytes and keeps one program serving both directions, with no JumpIfDirection.
library ZentisSpread {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;

    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    using ContextLib for Context;
    using Math for uint256;

    error ZentisSpreadTooWide(uint256 half);

    Opcode constant opcode = Opcode._9f;

    uint256 constant BPS = 10_000;
    /// @dev FeeFlat's own base. Zentis works in 1e4; convert at this boundary, never mix the two.
    uint256 constant FEE_BASE = 1e7;

    function sizeOf() internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 86;
    }

    /// @param floorOutA Soft-bound floor for tokenA, the lower-addressed token, in its own raw units.
    /// @param floorOutB Soft-bound floor for tokenB, in its own raw units. Zero on either side
    ///        disables the ramp for that direction only.
    function build(address ref, bytes32 positionId, uint128 floorOutA, uint128 floorOutB, uint16 maxWidenBps)
        internal
        pure
        returns (bytes memory)
    {
        return build(MemoryPtrLib.alloc(sizeOf()), ref, positionId, floorOutA, floorOutB, maxWidenBps)
            .resolve();
    }

    function build(
        MemoryPtr ptrStart,
        address ref,
        bytes32 positionId,
        uint128 floorOutA,
        uint128 floorOutB,
        uint16 maxWidenBps
    ) internal pure returns (MemoryPtr ptr) {
        ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(ref);
        ptr = ptr.push(positionId, 32);
        ptr = ptr.push(uint256(floorOutA), 16);
        ptr = ptr.push(uint256(floorOutB), 16);
        ptr = ptr.push(maxWidenBps, 2);
        ptrStart.patchLength(ptr);
    }

    function parse(bytes calldata args)
        internal
        pure
        returns (address ref, bytes32 positionId, uint256 floorOutA, uint256 floorOutB, uint16 maxWidenBps)
    {
        ref = args.at(0).asAddress();
        positionId = args.at(20).asBytes32();
        floorOutA = args.at(52).asU128();
        floorOutB = args.at(68).asU128();
        maxWidenBps = args.at(84).asU16();
    }

    function exec(Context memory ctx, bytes calldata args) internal {
        (address ref, bytes32 positionId, uint256 floorOutA, uint256 floorOutB, uint16 maxWidenBps) =
            parse(args);
        ZentisRef memory r = IZentisRef(ref).refOf(positionId);

        // Same direction test ZentisSkew uses: MakerTraits sorts tokenA < tokenB, so the outbound
        // token is tokenA exactly when it is the lower-addressed one.
        uint256 floorOut = ctx.query.tokenOut < ctx.query.tokenIn ? floorOutA : floorOutB;

        uint256 half = uint256(r.spreadBps) // base
            + uint256(r.markoutBps) // adverse selection, measured off indexed fills
            + ZentisTiltLib.softBoundWidenBps(ctx.swap.balanceOut, floorOut, maxWidenBps);
        require(half < BPS, ZentisSpreadTooWide(half));

        uint256 feeBps = half * FEE_BASE / BPS; // Zentis 1e4 base -> FeeFlat 1e7 base

        // Same shape as FeeFlatIn, including the partial-fill correction: shrink amountIn before
        // pricing, re-add after, and only charge on the part that actually filled.
        if (ctx.query.isExactIn) {
            uint256 fee = (ctx.swap.amountIn * feeBps).ceilDiv(FEE_BASE);
            ctx.swap.amountIn -= fee;

            uint256 reduction = ctx.swap.amountIn;
            ctx.runLoop();
            reduction -= ctx.swap.amountIn;

            if (reduction == 0) ctx.swap.amountIn += fee;
            else ctx.swap.amountIn += (ctx.swap.amountIn * feeBps).ceilDiv(FEE_BASE - feeBps);
        } else {
            ctx.runLoop();
            ctx.swap.amountIn += (ctx.swap.amountIn * feeBps).ceilDiv(FEE_BASE - feeBps);
        }
    }
}
