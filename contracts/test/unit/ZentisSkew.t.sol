// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {ZentisRef} from "../../src/ref/IZentisRef.sol";
import {ZentisSkew} from "../../src/instructions/ZentisSkew.sol";
import {MockZentisRef, ZentisSkewHarness} from "../fixtures/ZentisSkewHarness.sol";

contract ZentisSkewTest is Test {
    ZentisSkewHarness internal harness;
    MockZentisRef internal ref;

    // MakerTraits sorts tokenA < tokenB, so these stand in for the sorted pair.
    address internal constant TOKEN_A = address(0xA);
    address internal constant TOKEN_B = address(0xB);

    bytes32 internal constant POSITION_ID = bytes32(uint256(1));
    uint32 internal constant MAX_STALENESS = 3600;
    uint16 internal constant MAX_TILT_BPS = 500;

    uint256 internal constant BALANCE_A = 1_000_000e18;
    uint256 internal constant BALANCE_B = 1_000_000e18;

    // Fixed reference timestamp; the registry stores the queried block's time, not the write's.
    uint40 internal constant REF_TIME = 1_000_000;

    function setUp() public {
        harness = new ZentisSkewHarness();
        ref = new MockZentisRef();
        vm.warp(REF_TIME);
    }

    function _setRef(int16 tiltBps, int64 dTiltPerA, uint128 refBalanceA, uint32 maxExtrapBps) private {
        ZentisRef memory r;
        r.mid = 1e18;
        r.spreadBps = 10;
        r.tiltBps = tiltBps;
        r.updatedAt = REF_TIME;
        r.seq = 1;
        r.refBalanceA = refBalanceA;
        r.dTiltPerA = dTiltPerA;
        r.maxExtrapBps = maxExtrapBps;
        r.bandEdgeBps = MAX_TILT_BPS;
        ref.set(r);
    }

    function _args(uint16 widenBpsPerMinute, uint16 maxWidenBps) private view returns (bytes memory) {
        return ZentisSkew.build(
            address(ref), POSITION_ID, MAX_STALENESS, MAX_TILT_BPS, widenBpsPerMinute, maxWidenBps
        );
    }

    /// @dev build() emits a full instruction (header + args); exec() is handed only the args.
    function _argsOnly(uint16 widenBpsPerMinute, uint16 maxWidenBps) private view returns (bytes memory out) {
        bytes memory full = _args(widenBpsPerMinute, maxWidenBps);
        out = new bytes(62);
        for (uint256 i = 0; i < 62; i++) {
            out[i] = full[full.length - 62 + i];
        }
    }

    // ---------------------------------------------------------------------
    // 3.2 — zero tilt is a no-op
    // ---------------------------------------------------------------------

    function test_TiltZeroIsPlainXYC() public {
        _setRef(0, 0, uint128(BALANCE_A), 1_000);
        bytes memory args = _argsOnly(0, 0);

        uint256 amountIn = 1_000e18;
        uint256 withSkew =
            harness.skewThenXycExactIn(BALANCE_A, BALANCE_B, amountIn, TOKEN_A, TOKEN_B, args);
        uint256 plain = harness.xycExactIn(BALANCE_A, BALANCE_B, amountIn);

        assertEq(withSkew, plain, "zero tilt must be byte-identical to the bare curve");
    }

    function test_TiltZero_LeavesBalanceInUntouched() public {
        _setRef(0, 0, uint128(BALANCE_A), 1_000);
        uint256 balanceIn =
            harness.skewBalanceIn(BALANCE_A, BALANCE_B, TOKEN_A, TOKEN_B, _argsOnly(0, 0));
        assertEq(balanceIn, BALANCE_A);
    }

    // ---------------------------------------------------------------------
    // 3.3 — the direction table (the classic sign bug)
    // ---------------------------------------------------------------------

    function test_DirectionSymmetry_OverweightA_SellingA_Discounts() public {
        // tilt > 0 => over-weight A => make A cheap. tokenOut == A => discount => balanceIn shrinks.
        _setRef(300, 0, uint128(BALANCE_A), 1_000);
        uint256 balanceIn = harness.skewBalanceIn(BALANCE_B, BALANCE_A, TOKEN_B, TOKEN_A, _argsOnly(0, 0));
        assertLt(balanceIn, BALANCE_B, "selling the over-weight token must discount");
    }

    function test_DirectionSymmetry_OverweightA_BuyingA_Charges() public {
        // tilt > 0, tokenOut == B => no discount => balanceIn grows => less B out.
        _setRef(300, 0, uint128(BALANCE_A), 1_000);
        uint256 balanceIn = harness.skewBalanceIn(BALANCE_A, BALANCE_B, TOKEN_A, TOKEN_B, _argsOnly(0, 0));
        assertGt(balanceIn, BALANCE_A, "buying more of the over-weight token must be penalised");
    }

    function test_DirectionSymmetry_OverweightB_SellingB_Discounts() public {
        // tilt < 0 => over-weight B => make B cheap. tokenOut == B => discount.
        _setRef(-300, 0, uint128(BALANCE_A), 1_000);
        uint256 balanceIn = harness.skewBalanceIn(BALANCE_A, BALANCE_B, TOKEN_A, TOKEN_B, _argsOnly(0, 0));
        assertLt(balanceIn, BALANCE_A, "selling the over-weight token must discount");
    }

    function test_DirectionSymmetry_OverweightB_BuyingB_Charges() public {
        _setRef(-300, 0, uint128(BALANCE_A), 1_000);
        uint256 balanceIn = harness.skewBalanceIn(BALANCE_B, BALANCE_A, TOKEN_B, TOKEN_A, _argsOnly(0, 0));
        assertGt(balanceIn, BALANCE_B, "buying more of the over-weight token must be penalised");
    }

    // ---------------------------------------------------------------------
    // 3.4 — the reference can never buy a better-than-curve quote
    // ---------------------------------------------------------------------

    function testFuzz_RefCannotOverQuote(int16 tiltBps, int64 dTiltPerA, uint32 maxExtrapBps, uint256 amountIn)
        public
    {
        amountIn = bound(amountIn, 1, 100_000e18);
        _setRef(tiltBps, dTiltPerA, uint128(BALANCE_A), maxExtrapBps);

        uint256 amountOut =
            harness.skewThenXycExactIn(BALANCE_A, BALANCE_B, amountIn, TOKEN_A, TOKEN_B, _argsOnly(0, 0));

        // balanceOut is never touched, so the curve can never pay out more than it holds — for any
        // reference at all, including a hostile one.
        assertLt(amountOut, BALANCE_B, "a reference must never be able to drain the outbound side");
    }

    function testFuzz_DiscountIsBoundedByMaxTiltBps(int16 tiltBps, uint256 amountIn) public {
        amountIn = bound(amountIn, 1e18, 10_000e18);
        _setRef(tiltBps, 0, uint128(BALANCE_A), 0);

        uint256 balanceIn = harness.skewBalanceIn(BALANCE_A, BALANCE_B, TOKEN_A, TOKEN_B, _argsOnly(0, 0));

        // |shift| <= maxTiltBps, so balanceIn stays within [BALANCE_A * (1-cap), BALANCE_A * (1+cap)].
        uint256 lower = BALANCE_A * (10_000 - MAX_TILT_BPS) / 10_000;
        uint256 upper = BALANCE_A * (10_000 + MAX_TILT_BPS) / 10_000 + 1; // +1 for the ceil rounding
        assertGe(balanceIn, lower);
        assertLe(balanceIn, upper);
    }

    // ---------------------------------------------------------------------
    // staleness ramp + runtime guards
    // ---------------------------------------------------------------------

    function test_StalenessRamp_WidensWithAge() public {
        _setRef(0, 0, uint128(BALANCE_A), 0);
        bytes memory args = _argsOnly(100, 1_000); // 100 bps per minute, capped at 1000

        uint256 fresh = harness.skewBalanceIn(BALANCE_A, BALANCE_B, TOKEN_A, TOKEN_B, args);
        vm.warp(REF_TIME + 120); // two minutes older
        uint256 stale = harness.skewBalanceIn(BALANCE_A, BALANCE_B, TOKEN_A, TOKEN_B, args);

        assertEq(fresh, BALANCE_A, "a fresh reference must not widen");
        assertGt(stale, fresh, "an aging reference must widen, monotonically");
    }

    function test_RevertsPastMaxStaleness() public {
        _setRef(0, 0, uint128(BALANCE_A), 0);
        bytes memory args = _argsOnly(0, 0);

        vm.warp(uint256(REF_TIME) + MAX_STALENESS + 1);
        vm.expectRevert();
        harness.skewBalanceIn(BALANCE_A, BALANCE_B, TOKEN_A, TOKEN_B, args);
    }

    function test_RevertsOnMissingReference() public {
        // No _setRef: updatedAt stays 0.
        vm.expectRevert(abi.encodeWithSelector(ZentisSkew.ZentisNoReference.selector, POSITION_ID));
        harness.skewBalanceIn(BALANCE_A, BALANCE_B, TOKEN_A, TOKEN_B, _argsOnly(0, 0));
    }

    function test_RevertsOnEmptyPosition() public {
        _setRef(0, 0, uint128(BALANCE_A), 0);
        vm.expectRevert(abi.encodeWithSelector(ZentisSkew.ZentisEmptyPosition.selector, 0, BALANCE_B));
        harness.skewBalanceIn(0, BALANCE_B, TOKEN_A, TOKEN_B, _argsOnly(0, 0));
    }

    function test_BuildRejectsZeroStaleness() public {
        vm.expectRevert(ZentisSkew.ZentisStalenessDisabled.selector);
        this.buildWithZeroStaleness();
    }

    function buildWithZeroStaleness() external view {
        ZentisSkew.build(address(ref), POSITION_ID, 0, MAX_TILT_BPS, 0, 0);
    }
}
