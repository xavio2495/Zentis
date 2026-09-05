// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ZentisTiltLib} from "../../src/libs/ZentisTiltLib.sol";
import {ZentisRef} from "../../src/ref/IZentisRef.sol";

/// @notice Cross-checks ZentisTiltLib against packages/reference-model's Python model. Regenerate
///         the fixture with `python3 packages/reference-model/scripts/generate_fixtures.py`.
contract ZentisTiltLibFixturesTest is Test {
    string private constant FIXTURE_PATH = "test/fixtures/tilt_vectors.json";

    function test_EffectiveTilt_MatchesReferenceModel() public view {
        string memory json = vm.readFile(FIXTURE_PATH);

        int256[] memory tiltBps = vm.parseJsonIntArray(json, ".effectiveTilt.tiltBps");
        uint256[] memory refBalanceA = vm.parseJsonUintArray(json, ".effectiveTilt.refBalanceA");
        int256[] memory dTiltPerA = vm.parseJsonIntArray(json, ".effectiveTilt.dTiltPerA");
        uint256[] memory maxExtrapBps = vm.parseJsonUintArray(json, ".effectiveTilt.maxExtrapBps");
        uint256[] memory liveBalanceA = vm.parseJsonUintArray(json, ".effectiveTilt.liveBalanceA");
        uint256[] memory maxTiltBps = vm.parseJsonUintArray(json, ".effectiveTilt.maxTiltBps");
        int256[] memory expected = vm.parseJsonIntArray(json, ".effectiveTilt.expected");

        assertGt(tiltBps.length, 0);
        assertEq(tiltBps.length, expected.length);

        for (uint256 i = 0; i < tiltBps.length; i++) {
            ZentisRef memory r;
            r.tiltBps = int16(tiltBps[i]);
            r.refBalanceA = uint128(refBalanceA[i]);
            r.dTiltPerA = int64(dTiltPerA[i]);
            r.maxExtrapBps = uint32(maxExtrapBps[i]);

            int256 tilt = ZentisTiltLib.effectiveTilt(r, liveBalanceA[i], uint16(maxTiltBps[i]));
            assertEq(tilt, expected[i], "effectiveTilt diverged from the Python reference model");
        }
    }

    function test_SoftBoundWidenBps_MatchesReferenceModel() public view {
        string memory json = vm.readFile(FIXTURE_PATH);

        uint256[] memory liveBalanceOut = vm.parseJsonUintArray(json, ".softBoundWidenBps.liveBalanceOut");
        uint256[] memory floor = vm.parseJsonUintArray(json, ".softBoundWidenBps.floor");
        uint256[] memory maxWidenBps = vm.parseJsonUintArray(json, ".softBoundWidenBps.maxWidenBps");
        uint256[] memory expected = vm.parseJsonUintArray(json, ".softBoundWidenBps.expected");

        assertGt(liveBalanceOut.length, 0);
        assertEq(liveBalanceOut.length, expected.length);

        for (uint256 i = 0; i < liveBalanceOut.length; i++) {
            uint256 widen = ZentisTiltLib.softBoundWidenBps(liveBalanceOut[i], floor[i], uint16(maxWidenBps[i]));
            assertEq(widen, expected[i], "softBoundWidenBps diverged from the Python reference model");
        }
    }
}
