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
import {ZentisContextLib} from "./ZentisContextLib.sol";

/// @notice ZentisSkew opcode: prices the maker's cross-chain inventory imbalance into the curve by
///         shifting balanceIn. Not a wrapper — mutates balanceIn and returns, the outer runLoop
///         continues on to the curve.
/// @dev Encoding: [address ref | bytes32 positionId | uint32 maxStaleness | uint16 maxTiltBps
///                 | uint16 widenBpsPerMinute | uint16 maxWidenBps]
library ZentisSkew {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;

    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    using ContextLib for Context;
    using Math for uint256;

    error ZentisStalenessDisabled();
    error ZentisBoundOutOfRange(uint16 maxTiltBps, uint16 maxWidenBps);
    error ZentisEmptyPosition(uint256 balanceIn, uint256 balanceOut);
    error ZentisNoReference(bytes32 positionId);
    error ZentisReferenceStale(uint256 age, uint32 maxStaleness);
    error ZentisSeqMismatch(uint32 pinned, uint32 actual);
    error ZentisRecomputeDetected();

    Opcode constant opcode = Opcode._9e;

    uint256 constant BPS = 10_000;

    function sizeOf() internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 62;
    }

    function build(
        address ref,
        bytes32 positionId,
        uint32 maxStaleness,
        uint16 maxTiltBps,
        uint16 widenBpsPerMinute,
        uint16 maxWidenBps
    ) internal pure returns (bytes memory) {
        return build(
            MemoryPtrLib.alloc(sizeOf()), ref, positionId, maxStaleness, maxTiltBps, widenBpsPerMinute, maxWidenBps
        ).resolve();
    }

    function build(
        MemoryPtr ptrStart,
        address ref,
        bytes32 positionId,
        uint32 maxStaleness,
        uint16 maxTiltBps,
        uint16 widenBpsPerMinute,
        uint16 maxWidenBps
    ) internal pure returns (MemoryPtr ptr) {
        require(maxStaleness != 0, ZentisStalenessDisabled());
        require(maxTiltBps < BPS && maxWidenBps < BPS, ZentisBoundOutOfRange(maxTiltBps, maxWidenBps));

        ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(ref);
        ptr = ptr.push(positionId, 32);
        ptr = ptr.push(maxStaleness, 4);
        ptr = ptr.push(maxTiltBps, 2);
        ptr = ptr.push(widenBpsPerMinute, 2);
        ptr = ptr.push(maxWidenBps, 2);
        ptrStart.patchLength(ptr);
    }

    function parse(bytes calldata args)
        internal
        pure
        returns (
            address ref,
            bytes32 positionId,
            uint32 maxStaleness,
            uint16 maxTiltBps,
            uint16 widenBpsPerMinute,
            uint16 maxWidenBps
        )
    {
        ref = args.at(0).asAddress();
        positionId = args.at(20).asBytes32();
        maxStaleness = args.at(52).asU32();
        maxTiltBps = args.at(56).asU16();
        widenBpsPerMinute = args.at(58).asU16();
        maxWidenBps = args.at(60).asU16();
    }

    function exec(Context memory ctx, bytes calldata args) internal view {
        (
            address ref,
            bytes32 positionId,
            uint32 maxStaleness,
            uint16 maxTiltBps,
            uint16 widenBpsPerMinute,
            uint16 maxWidenBps
        ) = parse(args);

        // Runtime validation — build()'s requires are NOT re-run by the VM.
        require(maxStaleness != 0, ZentisStalenessDisabled()); // 0 REJECTS, it never disables
        require(maxTiltBps < BPS && maxWidenBps < BPS, ZentisBoundOutOfRange(maxTiltBps, maxWidenBps));
        require(
            ctx.swap.balanceIn > 0 && ctx.swap.balanceOut > 0,
            ZentisEmptyPosition(ctx.swap.balanceIn, ctx.swap.balanceOut)
        );
        require(ctx.swap.amountIn == 0 || ctx.swap.amountOut == 0, ZentisRecomputeDetected());

        ZentisRef memory r = IZentisRef(ref).refOf(positionId);
        require(r.updatedAt != 0, ZentisNoReference(positionId));
        require(r.updatedAt <= block.timestamp, ZentisReferenceStale(0, maxStaleness));
        uint256 age = block.timestamp - r.updatedAt;
        require(age <= maxStaleness, ZentisReferenceStale(age, maxStaleness));

        // Optional generation pin: 0 or absent = unpinned. The taker is already protected by
        // TakerTraits.threshold and the maker by ZentisBand, so a mandatory pin protects nobody and
        // only adds a revert path. It exists for a solver batching fills across a reference update.
        bytes calldata pin = ctx.tryChopTakerArgs(4);
        if (pin.length == 4) {
            uint32 pinned = pin.at(0).asU32();
            require(pinned == 0 || pinned == r.seq, ZentisSeqMismatch(pinned, r.seq));
        }

        int256 tilt = ZentisTiltLib.effectiveTilt(r, ZentisContextLib.liveA(ctx), maxTiltBps);
        uint256 mag = uint256(tilt < 0 ? -tilt : tilt);

        // tilt > 0 => over-weight tokenA here => make tokenA cheap. MakerTraits sorts tokenA < tokenB.
        bool outIsTokenA = ctx.query.tokenOut < ctx.query.tokenIn;
        bool discount = (tilt > 0) == outIsTokenA;

        // Staleness ramp: widen before going dark.
        uint256 widen = uint256(widenBpsPerMinute) * age / 60;
        if (widen > maxWidenBps) widen = maxWidenBps;

        // Growing balanceIn is worse for the taker in BOTH directions:
        //   exactIn : amountOut = amountIn*balanceOut/(balanceIn+amountIn)   — decreasing in balanceIn
        //   exactOut: amountIn  = amountOut*balanceIn/(balanceOut-amountOut) — increasing in balanceIn
        uint256 mult = BPS + widen;
        mult = discount ? mult - mag : mult + mag; // mag <= maxTiltBps < BPS => mult >= 1

        // Ceil always: a larger balanceIn is maker-favourable in both directions, so one rounding
        // rule satisfies the no-free-value invariant for both the widen and the discount.
        ctx.swap.balanceIn = Math.mulDiv(ctx.swap.balanceIn, mult, BPS, Math.Rounding.Ceil);

        // No runLoop, no post-processing, no clamp. balanceOut is untouched, so
        //   amountOut = amountIn*balanceOut/(balanceIn' + amountIn) < balanceOut
        // holds for every balanceIn' > 0. Over-quoting is unreachable, not guarded.
    }
}
