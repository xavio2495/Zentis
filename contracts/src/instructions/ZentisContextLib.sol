// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd
/// @custom:modified-by Zentis, 2026 — new instruction library for the SwapVM runtime.

import {Context} from "swap-vm/libs/VM.sol";

/// @notice The one piece of tilt math that has to touch SwapVM's Context. Kept out of
///         ZentisTiltLib so that library stays runtime-independent and unit-testable standalone.
library ZentisContextLib {
    /// @notice Live tokenA balance from the already-loaded registers. MakerTraits sorts
    ///         tokenA < tokenB, so the lower-addressed side of the swap is tokenA.
    function liveA(Context memory ctx) internal pure returns (uint256) {
        return ctx.query.tokenIn < ctx.query.tokenOut ? ctx.swap.balanceIn : ctx.swap.balanceOut;
    }
}
