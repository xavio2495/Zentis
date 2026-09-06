// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {XYCSwap} from "swap-vm/instructions/XYCSwap.sol";

import {ZentisRef} from "../../src/ref/IZentisRef.sol";
import {ZentisSpread} from "../../src/instructions/ZentisSpread.sol";
import {MockZentisRef} from "../fixtures/ZentisSkewHarness.sol";
import {ZentisProgramHarness} from "../fixtures/ZentisProgramHarness.sol";

contract ZentisSpreadTest is Test {
    ZentisProgramHarness internal harness;
    MockZentisRef internal ref;

    address internal constant TOKEN_A = address(0xA);
    address internal constant TOKEN_B = address(0xB);
    bytes32 internal constant POSITION_ID = bytes32(uint256(1));

    uint256 internal constant BALANCE_A = 1_000_000e18;
    uint256 internal constant BALANCE_B = 1_000_000e18;
    uint256 internal constant AMOUNT_IN = 1_000e18;

    function setUp() public {
        harness = new ZentisProgramHarness();
        ref = new MockZentisRef();
    }

    function _setRef(uint16 spreadBps, uint16 markoutBps) private {
        ZentisRef memory r;
        r.mid = 1e18;
        r.spreadBps = spreadBps;
        r.markoutBps = markoutBps;
        r.updatedAt = uint40(block.timestamp);
        r.seq = 1;
        ref.set(r);
    }

    /// @dev [ZentisSpread(...)] wrapping [XYCSwap] — the wrapper runs, then runLoop reaches the curve.
    function _program(uint128 floorOut, uint16 maxWidenBps) private view returns (bytes memory) {
        return bytes.concat(
            ZentisSpread.build(address(ref), POSITION_ID, floorOut, maxWidenBps), XYCSwap.build()
        );
    }

    function _setup(bool isExactIn, uint256 amount)
        private
        pure
        returns (ZentisProgramHarness.Setup memory s)
    {
        s.balanceIn = BALANCE_A;
        s.balanceOut = BALANCE_B;
        s.amount = amount;
        s.isExactIn = isExactIn;
        s.tokenIn = TOKEN_A;
        s.tokenOut = TOKEN_B;
    }

    function _bareCurve(bool isExactIn, uint256 amount) private returns (uint256, uint256) {
        return harness.run(XYCSwap.build(), _setup(isExactIn, amount));
    }

    // ---------------------------------------------------------------------
    // zero spread is a no-op
    // ---------------------------------------------------------------------

    function test_ZeroSpreadIsPlainXYC() public {
        _setRef(0, 0);
        (, uint256 amountOut) = harness.run(_program(0, 0), _setup(true, AMOUNT_IN));
        (, uint256 bare) = _bareCurve(true, AMOUNT_IN);
        assertEq(amountOut, bare, "a zero half-spread must not move the quote");
    }

    // ---------------------------------------------------------------------
    // the fee only ever costs the taker
    // ---------------------------------------------------------------------

    function test_SpreadReducesAmountOut_ExactIn() public {
        _setRef(100, 0); // 1%
        (, uint256 amountOut) = harness.run(_program(0, 0), _setup(true, AMOUNT_IN));
        (, uint256 bare) = _bareCurve(true, AMOUNT_IN);
        assertLt(amountOut, bare, "a half-spread must reduce what the taker receives");
    }

    function test_SpreadIncreasesAmountIn_ExactOut() public {
        _setRef(100, 0);
        uint256 amountOutWanted = 1_000e18;
        (uint256 amountIn,) = harness.run(_program(0, 0), _setup(false, amountOutWanted));
        (uint256 bareIn,) = _bareCurve(false, amountOutWanted);
        assertGt(amountIn, bareIn, "a half-spread must increase what the taker pays");
    }

    /// @dev The Zentis BPS base is 1e4, FeeFlat's is 1e7. Converting wrongly is a 1000x error, which
    ///      a magnitude check catches and a direction check does not.
    function test_BpsConversionMagnitude() public {
        _setRef(100, 0); // 1% => amountIn is shrunk 1% before pricing
        (, uint256 amountOut) = harness.run(_program(0, 0), _setup(true, AMOUNT_IN));
        (, uint256 bareOn99Percent) = harness.run(XYCSwap.build(), _setup(true, AMOUNT_IN * 99 / 100));

        assertApproxEqRel(amountOut, bareOn99Percent, 1e12, "1% half-spread must price 99% of amountIn");
    }

    function test_MarkoutAddsToSpread() public {
        _setRef(100, 0);
        (, uint256 withoutMarkout) = harness.run(_program(0, 0), _setup(true, AMOUNT_IN));
        _setRef(100, 50); // same base spread, plus adverse-selection term
        (, uint256 withMarkout) = harness.run(_program(0, 0), _setup(true, AMOUNT_IN));
        assertLt(withMarkout, withoutMarkout, "the markout term must widen the spread");
    }

    // ---------------------------------------------------------------------
    // the soft bound: widen as the outbound side approaches its floor
    // ---------------------------------------------------------------------

    function test_SoftBound_WidensNearFloor() public {
        _setRef(10, 0);
        // floorOut just under balanceOut => deep into the ramp. balanceOut >= 2*floor => no widen.
        uint128 farFloor = uint128(BALANCE_B / 4);
        uint128 nearFloor = uint128(BALANCE_B * 9 / 10);

        (, uint256 far) = harness.run(_program(farFloor, 500), _setup(true, AMOUNT_IN));
        (, uint256 near) = harness.run(_program(nearFloor, 500), _setup(true, AMOUNT_IN));

        assertLt(near, far, "approaching the floor must widen the spread");
    }

    function test_SoftBound_DisabledAtZeroFloor() public {
        _setRef(10, 0);
        (, uint256 withFloorZero) = harness.run(_program(0, 500), _setup(true, AMOUNT_IN));
        (, uint256 withFloorFar) = harness.run(_program(uint128(BALANCE_B / 4), 500), _setup(true, AMOUNT_IN));
        assertEq(withFloorZero, withFloorFar, "floor 0 disables the ramp, same as being far from it");
    }

    // ---------------------------------------------------------------------
    // guards
    // ---------------------------------------------------------------------

    function test_RevertsWhenSpreadReachesFullWidth() public {
        _setRef(9_000, 1_000); // 9000 + 1000 == BPS
        vm.expectRevert(abi.encodeWithSelector(ZentisSpread.ZentisSpreadTooWide.selector, 10_000));
        harness.run(_program(0, 0), _setup(true, AMOUNT_IN));
    }

    // ---------------------------------------------------------------------
    // the fee is monotone in the spread, and never gives value away
    // ---------------------------------------------------------------------

    function testFuzz_WiderSpreadNeverPaysTakerMore(uint16 spreadBps, uint256 amountIn) public {
        spreadBps = uint16(bound(spreadBps, 0, 4_000));
        amountIn = bound(amountIn, 1e15, 10_000e18);

        _setRef(spreadBps, 0);
        (, uint256 narrow) = harness.run(_program(0, 0), _setup(true, amountIn));

        _setRef(uint16(bound(uint256(spreadBps) + 100, 0, 9_000)), 0);
        (, uint256 wide) = harness.run(_program(0, 0), _setup(true, amountIn));

        assertLe(wide, narrow, "widening the spread must never pay the taker more");
    }

    function testFuzz_NeverPaysOutMoreThanTheCurveWould(uint16 spreadBps, uint256 amountIn) public {
        spreadBps = uint16(bound(spreadBps, 0, 9_000));
        amountIn = bound(amountIn, 1e15, 100_000e18);

        _setRef(spreadBps, 0);
        (, uint256 amountOut) = harness.run(_program(0, 0), _setup(true, amountIn));
        (, uint256 bare) = _bareCurve(true, amountIn);

        assertLe(amountOut, bare, "the spread is a fee; it can never improve the taker's fill");
        assertLt(amountOut, BALANCE_B, "and can never drain the outbound side");
    }
}
