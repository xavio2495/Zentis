// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {VmSafe} from "forge-std/Vm.sol";

import {ZentisStrategies} from "../src/strategies/ZentisStrategies.sol";

/// @notice The one place the live position's parameters are defined. Ship and fill both build the
///         position from here, so the two scripts produce byte-identical programs — and therefore
///         the same strategyHash — without either of them hand-typing a parameter.
library ZentisPositionConfig {
    // 5% of the reference mid on either side, on top of the published spread and tilt.
    uint16 internal constant BAND_TOL_BPS = 500;

    // Soft-bound floors, each in its own token's raw units: 2 USDC (6dp) and 0.001 WETH (18dp).
    // Direction-selected — one floor cannot serve a 6dp/18dp pair.
    uint128 internal constant FLOOR_OUT_A = 2e6;
    uint128 internal constant FLOOR_OUT_B = 0.001e18;

    uint16 internal constant SPREAD_MAX_WIDEN_BPS = 200;

    // The reference is republished far more often than this; an hour is the go-dark boundary.
    uint32 internal constant MAX_STALENESS = 1 hours;
    // A reference is published at its finalized block, sixteen to twenty minutes behind the head, so
    // at 10 bps a minute every quote opened at or near the 200 bps cap. At 2 the ramp is ~36 bps at
    // publish and reaches 120 at the hour, where the position goes dark anyway.
    uint16 internal constant WIDEN_BPS_PER_MINUTE = 2;
    uint16 internal constant SKEW_MAX_WIDEN_BPS = 200;

    // 500 is the number to sign on mainnet, where arbitrage keeps a reference pool within a few
    // percent of the market. The testnet pools these legs price from are not arbitraged and moved
    // 7-30% in a day (2026-09-10), which pinned every leg at a 500 cap within hours of shipping and
    // hid the whole decomposition. On the testnets the cap is 5000 so drift shows as correction.
    uint16 internal constant MAX_TILT_BPS = 5000;

    /// @dev `deadline` and `chainSalt` come from the environment rather than the clock: a script
    ///      that derived the deadline from `block.timestamp` would build a different program on
    ///      every run, and the fill script has to reproduce the shipped one exactly.
    function fromEnv(VmSafe vm, address ref)
        internal
        view
        returns (ZentisStrategies.ZentisPosition memory p)
    {
        p.ref = ref;
        p.positionId = vm.envBytes32("POSITION_ID");
        p.deadline = uint40(vm.envUint("POSITION_DEADLINE"));
        p.chainSalt = uint64(block.chainid);
        p.bandTolBps = BAND_TOL_BPS;
        p.floorOutA = FLOOR_OUT_A;
        p.floorOutB = FLOOR_OUT_B;
        p.spreadMaxWidenBps = SPREAD_MAX_WIDEN_BPS;
        p.maxStaleness = MAX_STALENESS;
        p.widenBpsPerMinute = WIDEN_BPS_PER_MINUTE;
        p.skewMaxWidenBps = SKEW_MAX_WIDEN_BPS;
        p.maxTiltBps = MAX_TILT_BPS;
    }
}
