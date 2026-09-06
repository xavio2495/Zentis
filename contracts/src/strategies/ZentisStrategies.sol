// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2026 Degensoft Ltd
/// @custom:modified-by Zentis, 2026 — a third vetted recipe in the shape of Strategies.sol.

import {MemoryPtr, MemoryPtrLib} from "swap-vm/libs/MemoryPtr.sol";
import {InstructionArgs} from "swap-vm/libs/InstructionArgs.sol";

import {Deadline, Salt} from "swap-vm/instructions/Controls.sol";
import {FeeProtocol} from "swap-vm/instructions/FeeProtocol.sol";
import {XYCSwap} from "swap-vm/instructions/XYCSwap.sol";

import {ZentisSkew} from "../instructions/ZentisSkew.sol";
import {ZentisSpread} from "../instructions/ZentisSpread.sol";
import {ZentisBand} from "../instructions/ZentisBand.sol";

/// @notice The Zentis position recipe, in the shape of the pinned `Strategies.sol`: a prefix of
///         validation-only opcodes checked against a bitmap, then a fixed, vetted instruction body.
///         A maker never hand-assembles a Zentis program; they call this.
library ZentisStrategies {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;

    using MemoryPtrLib for MemoryPtr;

    error PrefixInvalidLength(uint256 length, uint256 expected);
    error PrefixUnregistered(uint8 opcode);

    /// @notice One parameter set for one position on one chain.
    /// @dev `maxTiltBps` appears once here and is emitted to BOTH `ZentisSkew` and `ZentisBand`.
    ///      The two instructions each carry their own copy in their immediates — deliberately, so the
    ///      band is computed against the same effective tilt that was priced — but a maker who could
    ///      set them independently could typo one and silently loosen the guard without changing the
    ///      pricing. Emitting both from a single field makes that unrepresentable.
    struct ZentisPosition {
        address ref; // ZentisRefRegistry for this chain
        bytes32 positionId; // cross-chain identity; NOT the per-chain strategyHash
        uint40 deadline;
        uint64 chainSalt; // makes the strategyHash distinct per chain
        // protocol fee — omitted from the program entirely when feeBps == 0
        address feeReceiver;
        uint24 feeBps;
        bool feeOnTokenIn;
        // ZentisBand
        uint16 bandTolBps;
        // ZentisSpread
        uint128 floorOutA; // soft-bound floor for tokenA, in tokenA's own raw units
        uint128 floorOutB; // ...and for tokenB; the two sides do not share decimals
        uint16 spreadMaxWidenBps;
        // ZentisSkew
        uint32 maxStaleness;
        uint16 widenBpsPerMinute;
        uint16 skewMaxWidenBps;
        // shared by ZentisSkew and ZentisBand
        uint16 maxTiltBps;
    }

    /// @dev Only two entries, against the pinned `Strategies._prefixBitmap`'s seven: the Zentis opcode
    ///      table has exactly two validation-only instructions. The token validators and
    ///      `ValidateSeriesEpoch` are not reachable from a Zentis router, so admitting them here would
    ///      build programs that revert with `UnknownOpcode` at execution time.
    uint256 private constant _prefixBitmap =
        (1 << uint256(Deadline.opcode)) | (1 << uint256(Salt.opcode));

    function _checkPrefix(bytes[] calldata instructions) private pure returns (uint256 prefixSize) {
        for (uint256 i; i < instructions.length; i++) {
            bytes calldata instruction = instructions[i];
            uint8 opcode = instruction.at(0).asU8();
            uint256 length = 2 + instruction.at(1).asU8();

            require(instruction.length == length, PrefixInvalidLength(instruction.length, length));
            require(_prefixBitmap & (1 << opcode) != 0, PrefixUnregistered(opcode));

            prefixSize += instruction.length;
        }
    }

    /// @notice Builds the vetted Zentis program. Byte order IS nesting, outermost first:
    ///
    ///     Deadline(t)
    ///     FeeProtocol(feeBps, receiver)                     <- accrues on final amounts
    ///       ZentisBand(ref, positionId, tolBps, maxTilt)
    ///         ZentisSpread(ref, positionId, floors, maxW)   <- shrinks amountIn BEFORE pricing
    ///           ZentisSkew(ref, positionId, ...)            <- mutates balanceIn
    ///           XYCSwap()                                   <- prices
    ///     Salt(positionId || chainSalt)
    ///
    /// @dev `ZentisBand` sits OUTSIDE `ZentisSpread` deliberately. Inside, it would measure the curve
    ///      rate net of the spread — but the spread stays with the maker, so that understates the
    ///      maker's outcome. Outside, it measures the taker-facing rate, which is what the maker
    ///      actually realises. It sits inside `FeeProtocol`, so it is gross of the protocol fee.
    ///
    ///      `ZentisSpread` must precede the curve in byte order or it wraps nothing — the general form
    ///      of the `FeeFlatIn`-after-curve trap.
    function buildZentisPosition(bytes[] calldata prefix, ZentisPosition calldata args)
        internal
        pure
        returns (bytes memory program)
    {
        bytes memory salt = abi.encodePacked(args.positionId, args.chainSalt);

        FeeProtocol.ReceiverConfig[] memory receivers;
        FeeProtocol.ProviderConfig[] memory providers;
        uint256 feeSize;
        if (args.feeBps != 0) {
            receivers = new FeeProtocol.ReceiverConfig[](1);
            receivers[0] = FeeProtocol.ReceiverConfig({
                receiver: args.feeReceiver,
                feeBps: args.feeBps,
                surplusBps: 0
            });
            providers = new FeeProtocol.ProviderConfig[](0);
            feeSize = FeeProtocol.sizeOf(args.feeOnTokenIn, receivers, providers, 0);
        }

        MemoryPtr ptr = MemoryPtrLib.alloc(
            _checkPrefix(prefix) +
            Deadline.sizeOf(args.deadline) +
            feeSize +
            ZentisBand.sizeOf() +
            ZentisSpread.sizeOf() +
            ZentisSkew.sizeOf() +
            XYCSwap.sizeOf() +
            Salt.sizeOf(salt)
        );

        for (uint256 i; i < prefix.length; i++) ptr = ptr.push(prefix[i]);

        ptr = Deadline.build(ptr, args.deadline);
        if (args.feeBps != 0) {
            ptr = FeeProtocol.build(ptr, args.feeOnTokenIn, receivers, providers, 0);
        }
        ptr = ZentisBand.build(ptr, args.ref, args.positionId, args.bandTolBps, args.maxTiltBps);
        ptr = ZentisSpread.build(
            ptr, args.ref, args.positionId, args.floorOutA, args.floorOutB, args.spreadMaxWidenBps
        );
        ptr = ZentisSkew.build(
            ptr,
            args.ref,
            args.positionId,
            args.maxStaleness,
            args.maxTiltBps, // the SAME field the band above was given
            args.widenBpsPerMinute,
            args.skewMaxWidenBps
        );
        ptr = XYCSwap.build(ptr);
        ptr = Salt.build(ptr, salt);

        // resolveShrink, not resolve: FeeProtocol.sizeOf always reserves 27 bytes for a surplus
        // estimate that build() only emits when a receiver takes a surplus fee, so the allocation is
        // deliberately loose. A strict resolve() reverts on the unfilled tail — and the pinned
        // Strategies.sol never hits this because neither of its two recipes uses FeeProtocol.
        (program, ) = ptr.resolveShrink();
    }
}
