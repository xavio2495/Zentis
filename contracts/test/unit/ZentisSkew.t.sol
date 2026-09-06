// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {XYCSwap} from "swap-vm/instructions/XYCSwap.sol";

import {ZentisRef} from "../../src/ref/IZentisRef.sol";
import {ZentisSkew} from "../../src/instructions/ZentisSkew.sol";
import {MockZentisRef, ZentisSkewHarness} from "../fixtures/ZentisSkewHarness.sol";
import {ZentisProgramHarness} from "../fixtures/ZentisProgramHarness.sol";

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

    // ---------------------------------------------------------------------
    // 3.3 — consecutive same-direction fills must get monotonically worse
    // ---------------------------------------------------------------------

    /// @dev The test that catches a wrong `dTiltPerA` sign. The taker keeps paying A and taking B, so
    ///      the maker keeps accumulating A — increasingly over-weight, and increasingly unwilling to
    ///      buy more of it. With the sign right, each successive fill pays out less. With it flipped,
    ///      accumulating A would *discount* A-for-B and the book would pay a splitter to keep going.
    function testFuzz_SequentialFillsAreNeverCheaper(uint256 amountIn, uint8 fills) public {
        amountIn = bound(amountIn, 1e18, 5_000e18);
        fills = uint8(bound(fills, 2, 6));

        // tilt starts at 0 and grows as balanceA does: 1 bp per 1e18 units of A accumulated.
        _setRef(0, 1, uint128(BALANCE_A), 1_000);

        ZentisProgramHarness programHarness = new ZentisProgramHarness();
        bytes memory program = bytes.concat(
            ZentisSkew.build(address(ref), POSITION_ID, MAX_STALENESS, MAX_TILT_BPS, 0, 0),
            XYCSwap.build()
        );

        uint256 balanceA = BALANCE_A;
        uint256 balanceB = BALANCE_B;
        uint256 previousOut = type(uint256).max;

        for (uint256 i = 0; i < fills; i++) {
            ZentisProgramHarness.Setup memory s;
            s.balanceIn = balanceA;
            s.balanceOut = balanceB;
            s.amount = amountIn;
            s.isExactIn = true;
            s.tokenIn = TOKEN_A;
            s.tokenOut = TOKEN_B;

            (, uint256 amountOut) = programHarness.run(program, s);
            assertLe(amountOut, previousOut, "a later same-direction fill must never be cheaper");

            previousOut = amountOut;
            balanceA += amountIn; // the maker took in A
            balanceB -= amountOut; // and paid out B
        }
    }

    // ---------------------------------------------------------------------
    // the recompute guard
    // ---------------------------------------------------------------------

    function _programHarness() private returns (ZentisProgramHarness) {
        return new ZentisProgramHarness();
    }

    function _skewInstruction() private view returns (bytes memory) {
        return ZentisSkew.build(address(ref), POSITION_ID, MAX_STALENESS, MAX_TILT_BPS, 0, 0);
    }

    function _programSetup() private pure returns (ZentisProgramHarness.Setup memory s) {
        s.balanceIn = BALANCE_A;
        s.balanceOut = BALANCE_B;
        s.amount = 1_000e18;
        s.isExactIn = true;
        s.tokenIn = TOKEN_A;
        s.tokenOut = TOKEN_B;
    }

    /// @dev The guard's real job: ZentisSkew shifts balanceIn to move the price, so it is only
    ///      meaningful before the curve prices. Reached afterwards, both amount registers are already
    ///      populated and the shift would be applied to an already-computed quote.
    function test_RecomputeGuard_RevertsWhenSkewRunsAfterTheCurve() public {
        _setRef(300, 0, uint128(BALANCE_A), 1_000);
        ZentisProgramHarness h = _programHarness();

        vm.expectRevert(ZentisSkew.ZentisRecomputeDetected.selector);
        h.run(bytes.concat(XYCSwap.build(), _skewInstruction()), _programSetup());
    }

    function test_RecomputeGuard_RevertsWhenSkewStraddlesTheCurve() public {
        _setRef(300, 0, uint128(BALANCE_A), 1_000);
        ZentisProgramHarness h = _programHarness();

        vm.expectRevert(ZentisSkew.ZentisRecomputeDetected.selector);
        h.run(bytes.concat(_skewInstruction(), XYCSwap.build(), _skewInstruction()), _programSetup());
    }

    /// @dev Documents a real limit of the guard, contra the tech spec's "running ZentisSkew twice
    ///      reverts": two skews *before* the curve both see an unpopulated amountOut, so the guard
    ///      passes and their multipliers compound. It is a maker footgun (the maker authors and ships
    ///      their own immutable program), not a taker attack, and ZentisBand catches the resulting
    ///      quote at execution time — see ZentisBand.t.sol's test_BandCatchesCompoundedDoubleSkew.
    function test_RecomputeGuard_DoesNotCatchDoubleSkewBeforeTheCurve() public {
        _setRef(300, 0, uint128(BALANCE_A), 1_000);
        ZentisProgramHarness h = _programHarness();

        (, uint256 doubleSkewed) =
            h.run(bytes.concat(_skewInstruction(), _skewInstruction(), XYCSwap.build()), _programSetup());
        (, uint256 singleSkewed) =
            h.run(bytes.concat(_skewInstruction(), XYCSwap.build()), _programSetup());

        assertTrue(doubleSkewed != singleSkewed, "two skews compound rather than reverting");
    }

    // ---------------------------------------------------------------------
    // the optional seq pin
    // ---------------------------------------------------------------------

    function test_SeqPin_AbsentPasses() public {
        _setRef(0, 0, uint128(BALANCE_A), 0);
        ZentisProgramHarness h = _programHarness();
        h.runWithTakerArgs(
            bytes.concat(_skewInstruction(), XYCSwap.build()), "", _programSetup()
        ); // must not revert
    }

    function test_SeqPin_ZeroPasses() public {
        _setRef(0, 0, uint128(BALANCE_A), 0);
        ZentisProgramHarness h = _programHarness();
        h.runWithTakerArgs(
            bytes.concat(_skewInstruction(), XYCSwap.build()),
            abi.encodePacked(uint32(0)),
            _programSetup()
        ); // must not revert
    }

    function test_SeqPin_MatchingPasses() public {
        _setRef(0, 0, uint128(BALANCE_A), 0); // _setRef writes seq = 1
        ZentisProgramHarness h = _programHarness();
        h.runWithTakerArgs(
            bytes.concat(_skewInstruction(), XYCSwap.build()),
            abi.encodePacked(uint32(1)),
            _programSetup()
        ); // must not revert
    }

    function test_SeqPin_StaleReverts() public {
        _setRef(0, 0, uint128(BALANCE_A), 0); // seq = 1
        ZentisProgramHarness h = _programHarness();

        vm.expectRevert(abi.encodeWithSelector(ZentisSkew.ZentisSeqMismatch.selector, uint32(99), uint32(1)));
        h.runWithTakerArgs(
            bytes.concat(_skewInstruction(), XYCSwap.build()),
            abi.encodePacked(uint32(99)),
            _programSetup()
        );
    }

    function test_BuildRejectsZeroStaleness() public {
        vm.expectRevert(ZentisSkew.ZentisStalenessDisabled.selector);
        this.buildWithZeroStaleness();
    }

    function buildWithZeroStaleness() external view {
        ZentisSkew.build(address(ref), POSITION_ID, 0, MAX_TILT_BPS, 0, 0);
    }
}
