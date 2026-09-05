// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ZentisTiltLib} from "../../src/libs/ZentisTiltLib.sol";
import {ZentisRef} from "../../src/ref/IZentisRef.sol";

contract ZentisTiltLibTest is Test {
    function _ref(int16 tiltBps, uint128 refBalanceA, int64 dTiltPerA, uint32 maxExtrapBps)
        private
        pure
        returns (ZentisRef memory r)
    {
        r.tiltBps = tiltBps;
        r.refBalanceA = refBalanceA;
        r.dTiltPerA = dTiltPerA;
        r.maxExtrapBps = maxExtrapBps;
    }

    // ---------------------------------------------------------------------
    // effectiveTilt
    // ---------------------------------------------------------------------

    function test_EffectiveTilt_NoDrift_ReturnsRefTilt() public pure {
        ZentisRef memory r = _ref(300, 1_000e18, 0, 1_000);
        int256 tilt = ZentisTiltLib.effectiveTilt(r, 1_000e18, 500);
        assertEq(tilt, 300);
    }

    function test_EffectiveTilt_ExtrapolatesWithInventoryDelta() public pure {
        // dTiltPerA = 1e18 => 1 tilt-bp per unit of balanceA delta.
        ZentisRef memory r = _ref(0, 1_000, 1e18, 1_000);
        int256 tilt = ZentisTiltLib.effectiveTilt(r, 1_050, 5_000);
        assertEq(tilt, 50);
    }

    function test_EffectiveTilt_NegativeDeltaTiltsOtherWay() public pure {
        ZentisRef memory r = _ref(0, 1_000, 1e18, 1_000);
        int256 tilt = ZentisTiltLib.effectiveTilt(r, 950, 5_000);
        assertEq(tilt, -50);
    }

    function test_EffectiveTilt_ClampedByMaxExtrapBps() public pure {
        ZentisRef memory r = _ref(0, 1_000, 1e18, 30);
        int256 tilt = ZentisTiltLib.effectiveTilt(r, 1_000_000, 5_000);
        assertEq(tilt, 30);
    }

    function test_EffectiveTilt_ClampedByMaxExtrapBps_Negative() public pure {
        ZentisRef memory r = _ref(0, 1_000, 1e18, 30);
        int256 tilt = ZentisTiltLib.effectiveTilt(r, 0, 5_000);
        assertEq(tilt, -30);
    }

    function test_EffectiveTilt_ClampedByHardMaxTiltBps() public pure {
        // refTilt alone already exceeds the hard cap.
        ZentisRef memory r = _ref(9_000, 1_000, 0, 1_000);
        int256 tilt = ZentisTiltLib.effectiveTilt(r, 1_000, 5_000);
        assertEq(tilt, 5_000);
    }

    function test_EffectiveTilt_ClampedByHardMaxTiltBps_Negative() public pure {
        ZentisRef memory r = _ref(-9_000, 1_000, 0, 1_000);
        int256 tilt = ZentisTiltLib.effectiveTilt(r, 1_000, 5_000);
        assertEq(tilt, -5_000);
    }

    function testFuzz_EffectiveTilt_AlwaysWithinHardCap(
        int16 tiltBps,
        uint128 refBalanceA,
        int64 dTiltPerA,
        uint32 maxExtrapBps,
        uint256 liveBalanceA,
        uint16 maxTiltBps
    ) public pure {
        liveBalanceA = bound(liveBalanceA, 0, type(uint128).max);
        ZentisRef memory r = _ref(tiltBps, refBalanceA, dTiltPerA, maxExtrapBps);

        int256 tilt = ZentisTiltLib.effectiveTilt(r, liveBalanceA, maxTiltBps);

        assertLe(tilt, int256(uint256(maxTiltBps)));
        assertGe(tilt, -int256(uint256(maxTiltBps)));
    }

    function testFuzz_EffectiveTilt_ZeroDrift_MatchesRefTiltClampedToHardCap(
        int16 tiltBps,
        uint128 refBalanceA,
        uint256 liveBalanceA,
        uint16 maxTiltBps
    ) public pure {
        liveBalanceA = bound(liveBalanceA, 0, type(uint128).max);
        ZentisRef memory r = _ref(tiltBps, refBalanceA, 0, type(uint32).max);

        int256 tilt = ZentisTiltLib.effectiveTilt(r, liveBalanceA, maxTiltBps);

        int256 hard = int256(uint256(maxTiltBps));
        int256 want = int256(tiltBps);
        if (want > hard) want = hard;
        if (want < -hard) want = -hard;
        assertEq(tilt, want);
    }

    // ---------------------------------------------------------------------
    // softBoundWidenBps
    // ---------------------------------------------------------------------

    function test_SoftBoundWidenBps_ZeroFloorDisabled() public pure {
        assertEq(ZentisTiltLib.softBoundWidenBps(0, 0, 500), 0);
    }

    function test_SoftBoundWidenBps_FarFromFloor_ReturnsZero() public pure {
        assertEq(ZentisTiltLib.softBoundWidenBps(200, 100, 500), 0);
    }

    function test_SoftBoundWidenBps_AtOrBelowFloor_ReturnsMax() public pure {
        assertEq(ZentisTiltLib.softBoundWidenBps(100, 100, 500), 500);
        assertEq(ZentisTiltLib.softBoundWidenBps(50, 100, 500), 500);
    }

    function test_SoftBoundWidenBps_Midpoint_IsHalfway() public pure {
        // liveBalanceOut = floor + floor/2 => room = floor/2 => half the ramp remains.
        assertEq(ZentisTiltLib.softBoundWidenBps(150, 100, 500), 250);
    }

    function testFuzz_SoftBoundWidenBps_BoundedByMax(uint256 liveBalanceOut, uint256 floor, uint16 maxWidenBps)
        public
        pure
    {
        floor = bound(floor, 0, type(uint128).max);
        liveBalanceOut = bound(liveBalanceOut, 0, type(uint128).max);

        uint256 widen = ZentisTiltLib.softBoundWidenBps(liveBalanceOut, floor, maxWidenBps);
        assertLe(widen, maxWidenBps);
    }

    function testFuzz_SoftBoundWidenBps_MonotoneNonIncreasing(uint256 floor, uint256 room1, uint256 room2, uint16 maxWidenBps)
        public
        pure
    {
        floor = bound(floor, 1, type(uint128).max);
        room1 = bound(room1, 0, floor);
        room2 = bound(room2, 0, floor);
        vm.assume(room1 <= room2);

        uint256 widenAt1 = ZentisTiltLib.softBoundWidenBps(floor + room1, floor, maxWidenBps);
        uint256 widenAt2 = ZentisTiltLib.softBoundWidenBps(floor + room2, floor, maxWidenBps);

        assertGe(widenAt1, widenAt2);
    }
}
