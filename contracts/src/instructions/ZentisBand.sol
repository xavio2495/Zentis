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

/// @notice ZentisBand opcode: the impulse boundary. Rejects a fill whose realised rate falls outside
///         the reference mid widened by the spread, the effective tilt and a tolerance. A wrapper —
///         it must see the final, taker-facing amounts.
/// @dev Encoding: [address ref | bytes32 positionId | uint16 tolBps | uint16 maxTiltBps] — 56 bytes.
///      maxTiltBps is duplicated from ZentisSkew deliberately: the band must be computed against the
///      same effective tilt that was priced, or it is silently looser than it looks.
library ZentisBand {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;

    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    using ContextLib for Context;

    error ZentisZeroAmount(uint256 amountIn, uint256 amountOut);
    error ZentisBandTooWide(uint256 band);
    error ZentisOutsideBand(uint256 realised, uint256 bound, bool isCeiling);

    Opcode constant opcode = Opcode._b3;

    uint256 constant BPS = 10_000;
    uint256 constant ONE = 1e18;

    function sizeOf() internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 56;
    }

    function build(address ref, bytes32 positionId, uint16 tolBps, uint16 maxTiltBps)
        internal
        pure
        returns (bytes memory)
    {
        return build(MemoryPtrLib.alloc(sizeOf()), ref, positionId, tolBps, maxTiltBps).resolve();
    }

    function build(MemoryPtr ptrStart, address ref, bytes32 positionId, uint16 tolBps, uint16 maxTiltBps)
        internal
        pure
        returns (MemoryPtr ptr)
    {
        ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(ref);
        ptr = ptr.push(positionId, 32);
        ptr = ptr.push(tolBps, 2);
        ptr = ptr.push(maxTiltBps, 2);
        ptrStart.patchLength(ptr);
    }

    function parse(bytes calldata args)
        internal
        pure
        returns (address ref, bytes32 positionId, uint16 tolBps, uint16 maxTiltBps)
    {
        ref = args.at(0).asAddress();
        positionId = args.at(20).asBytes32();
        tolBps = args.at(52).asU16();
        maxTiltBps = args.at(54).asU16();
    }

    function exec(Context memory ctx, bytes calldata args) internal {
        (address ref, bytes32 positionId, uint16 tolBps, uint16 maxTiltBps) = parse(args);
        ZentisRef memory r = IZentisRef(ref).refOf(positionId);
        uint256 liveA = ZentisContextLib.liveA(ctx); // BEFORE runLoop mutates the registers

        (uint256 amountIn, uint256 amountOut) = ctx.runLoop();

        // Guard the division. OraclePriceAdjuster divides by amountIn with no guard; we do not.
        require(amountIn > 0 && amountOut > 0, ZentisZeroAmount(amountIn, amountOut));

        // The slow workflow publishes its boundary here. It may only TIGHTEN the maker's signed cap:
        // widening it would let whoever writes the reference loosen a guard the maker committed to,
        // which is the whole reason maxTiltBps is an immediate in the first place. Zero means nothing
        // has been published yet — every reference written before that workflow existed carries one,
        // and reading it as a cap would collapse the band on all of them.
        uint16 cap = maxTiltBps;
        if (r.bandEdgeBps != 0 && r.bandEdgeBps < cap) cap = r.bandEdgeBps;

        // The same effective tilt ZentisSkew priced with — NOT raw r.tiltBps.
        int256 tilt = ZentisTiltLib.effectiveTilt(r, liveA, cap);
        uint256 band = uint256(r.spreadBps) + uint256(tilt < 0 ? -tilt : tilt) + tolBps;
        require(band < BPS, ZentisBandTooWide(band));

        // mid = raw tokenB per 1e18 raw tokenA. mulDiv (512-bit intermediate) rather than
        // RequireMinRate's cross-multiplication: its rates are uint64, ours carries a 1e18 scale
        // and would overflow.
        if (ctx.query.tokenIn < ctx.query.tokenOut) {
            // taker pays A, receives B => the maker BUYS A at amountOut/amountIn, and wants to pay LOW
            uint256 realised = Math.mulDiv(amountOut, ONE, amountIn);
            uint256 ceiling = Math.mulDiv(r.mid, BPS + band, BPS);
            require(realised <= ceiling, ZentisOutsideBand(realised, ceiling, true));
        } else {
            // taker pays B, receives A => the maker SELLS A at amountIn/amountOut, and wants HIGH
            uint256 realised = Math.mulDiv(amountIn, ONE, amountOut);
            uint256 floor_ = Math.mulDiv(r.mid, BPS - band, BPS);
            require(realised >= floor_, ZentisOutsideBand(realised, floor_, false));
        }
    }

    // Deliberately does NOT re-check staleness — ZentisSkew already rejected a stale reference.
    // Re-checking would be dead code and a second failure mode for one condition.
}
