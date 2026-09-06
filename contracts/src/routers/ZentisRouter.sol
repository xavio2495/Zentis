// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd
/// @custom:modified-by Zentis, 2026 — router over the SwapVM runtime with a Zentis opcode table.

import {Simulator} from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";

import {Context} from "swap-vm/libs/VM.sol";
import {SwapVM} from "swap-vm/SwapVM.sol";

import {ZentisOpcodes} from "../opcodes/ZentisOpcodes.sol";

/// @notice Mirrors AquaSwapVMRouter exactly — same base contracts, same _dispatch body — with a
///         7-entry opcode table instead of 16. Aqua settlement, EIP-712 hashing, the transient
///         per-order reentrancy guard, WETH handling and fee resolution are untouched.
contract ZentisRouter is Simulator, SwapVM, ZentisOpcodes {
    constructor(address aqua, address weth, address owner) SwapVM(aqua, weth, owner, "Zentis SwapVM", "1") {}

    /// @dev Dispatches an opcode to its handler for VM execution
    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        _runOpcode(ctx, opcode, args);
    }
}
