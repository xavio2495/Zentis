// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ZentisRef} from "../ref/IZentisRef.sol";

/// @notice Shared tilt math for ZentisSkew and ZentisBand. Both instructions must compute the
///         same effective tilt — computing it twice and letting them diverge makes the band
///         guard loose in exactly the case it exists for. Zero SwapVM/Aqua dependency.
library ZentisTiltLib {
    int256 internal constant BPS = 10_000;

    /// @notice Effective tilt = reference tilt, extrapolated to live inventory, clamped twice.
    /// @dev Exact, not first-order: the A-S pricing sub-model is linear in inventory, so
    ///      dTiltPerA is a constant and the extrapolation carries no approximation error.
    ///      maxExtrapBps is a safety clamp, not an accuracy bound.
    function effectiveTilt(ZentisRef memory r, uint256 liveBalanceA, uint16 maxTiltBps)
        internal
        pure
        returns (int256 tilt)
    {
        int256 delta = int256(liveBalanceA) - int256(uint256(r.refBalanceA));
        int256 adj = (delta * int256(r.dTiltPerA)) / 1e18;
        int256 cap = int256(uint256(r.maxExtrapBps));
        if (adj > cap) adj = cap;
        if (adj < -cap) adj = -cap;

        tilt = int256(r.tiltBps) + adj;
        int256 hard = int256(uint256(maxTiltBps));
        if (tilt > hard) tilt = hard;
        if (tilt < -hard) tilt = -hard;
    }

    /// @notice Soft bound: monotone ramp as the outbound side approaches its floor.
    ///         Continuous by design — a cliff is a bad outcome for the taker and a
    ///         worse one for the maker, and gives a solver a discontinuity to route around.
    function softBoundWidenBps(uint256 liveBalanceOut, uint256 floor, uint16 maxWidenBps)
        internal
        pure
        returns (uint256)
    {
        if (floor == 0 || liveBalanceOut >= floor * 2) return 0;
        if (liveBalanceOut <= floor) return maxWidenBps;
        uint256 room = liveBalanceOut - floor; // 0 .. floor
        return maxWidenBps - (maxWidenBps * room) / floor;
    }
}
