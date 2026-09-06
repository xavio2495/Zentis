// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd
/// @custom:modified-by Zentis, 2026 — opcode table for the SwapVM runtime.

import {Context} from "swap-vm/libs/VM.sol";
import {Opcode, OpcodeOps} from "swap-vm/libs/OpcodeList.sol";

import {Deadline, Salt} from "swap-vm/instructions/Controls.sol";
import {FeeProtocol} from "swap-vm/instructions/FeeProtocol.sol";
import {XYCSwap} from "swap-vm/instructions/XYCSwap.sol";

import {ZentisSkew} from "../instructions/ZentisSkew.sol";
import {ZentisSpread} from "../instructions/ZentisSpread.sol";
import {ZentisBand} from "../instructions/ZentisBand.sol";

contract ZentisOpcodes {
    using OpcodeOps for Opcode;

    error UnknownOpcode(uint256 opcode);

    /// @dev Seven reachable instructions. Deliberately NOT inheriting AquaOpcodes: its sixteen
    ///      entries (PeggedSwap, XYCConcentrateSwap, Decay, Extruction, the jumps, the token
    ///      validators) are unreachable from any Zentis program, cost contract size against the
    ///      EIP-170 limit, and Extruction in particular is an arbitrary-external-call surface a
    ///      maker has no use for.
    ///
    ///      No StaticBalances/DynamicBalances either: Aqua preloads the registers before runLoop,
    ///      so a balance opcode in an Aqua router is a bug — which is why stock AquaOpcodes omits
    ///      both as well.
    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal virtual {
        if (opcode == Deadline.opcode.asU8()) Deadline.exec(ctx, args);
        else if (opcode == Salt.opcode.asU8()) Salt.exec(ctx, args);
        else if (opcode == FeeProtocol.opcode.asU8()) FeeProtocol.exec(ctx, args);
        else if (opcode == XYCSwap.opcode.asU8()) XYCSwap.exec(ctx, args);
        else if (opcode == ZentisSkew.opcode.asU8()) ZentisSkew.exec(ctx, args);
        else if (opcode == ZentisSpread.opcode.asU8()) ZentisSpread.exec(ctx, args);
        else if (opcode == ZentisBand.opcode.asU8()) ZentisBand.exec(ctx, args);
        else revert UnknownOpcode(opcode);
    }
}
