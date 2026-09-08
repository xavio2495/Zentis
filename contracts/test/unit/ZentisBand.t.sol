// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {XYCSwap} from "swap-vm/instructions/XYCSwap.sol";

import {ZentisRef} from "../../src/ref/IZentisRef.sol";
import {ZentisBand} from "../../src/instructions/ZentisBand.sol";
import {ZentisSkew} from "../../src/instructions/ZentisSkew.sol";
import {MockZentisRef} from "../fixtures/ZentisSkewHarness.sol";
import {ZentisProgramHarness} from "../fixtures/ZentisProgramHarness.sol";

contract ZentisBandTest is Test {
    ZentisProgramHarness internal harness;
    MockZentisRef internal ref;

    address internal constant TOKEN_A = address(0xA);
    address internal constant TOKEN_B = address(0xB);
    bytes32 internal constant POSITION_ID = bytes32(uint256(1));

    uint256 internal constant BALANCE_A = 1_000_000e18;
    uint256 internal constant BALANCE_B = 1_000_000e18;
    uint256 internal constant AMOUNT_IN = 1_000e18;

    uint16 internal constant MAX_TILT_BPS = 500;
    uint32 internal constant MAX_STALENESS = 3600;
    uint40 internal constant REF_TIME = 1_000_000;

    function setUp() public {
        harness = new ZentisProgramHarness();
        ref = new MockZentisRef();
        vm.warp(REF_TIME);
    }

    function _setRef(uint128 mid, uint16 spreadBps, int16 tiltBps, int64 dTiltPerA, uint128 refBalanceA)
        private
    {
        _setRef(mid, spreadBps, tiltBps, dTiltPerA, refBalanceA, MAX_TILT_BPS);
    }

    function _setRef(
        uint128 mid,
        uint16 spreadBps,
        int16 tiltBps,
        int64 dTiltPerA,
        uint128 refBalanceA,
        uint16 bandEdgeBps
    ) private {
        ZentisRef memory r;
        r.mid = mid;
        r.spreadBps = spreadBps;
        r.tiltBps = tiltBps;
        r.updatedAt = REF_TIME;
        r.seq = 1;
        r.refBalanceA = refBalanceA;
        r.dTiltPerA = dTiltPerA;
        r.maxExtrapBps = 1_000;
        r.bandEdgeBps = bandEdgeBps;
        ref.set(r);
    }

    function _setup(bool isExactIn, uint256 amount, bool aIsIn)
        private
        pure
        returns (ZentisProgramHarness.Setup memory s)
    {
        s.balanceIn = BALANCE_A;
        s.balanceOut = BALANCE_B;
        s.amount = amount;
        s.isExactIn = isExactIn;
        s.tokenIn = aIsIn ? TOKEN_A : TOKEN_B;
        s.tokenOut = aIsIn ? TOKEN_B : TOKEN_A;
    }

    function _bandProgram(uint16 tolBps) private view returns (bytes memory) {
        return bytes.concat(
            ZentisBand.build(address(ref), POSITION_ID, tolBps, MAX_TILT_BPS), XYCSwap.build()
        );
    }

    /// @dev The realised rate the bare curve produces, in the band's own units.
    function _bareRealised() private returns (uint256) {
        (uint256 amountIn, uint256 amountOut) = harness.run(XYCSwap.build(), _setup(true, AMOUNT_IN, true));
        return amountOut * 1e18 / amountIn;
    }

    // ---------------------------------------------------------------------
    // the band admits a fair fill and rejects a mispriced one
    // ---------------------------------------------------------------------

    function test_AdmitsFillAtReferenceMid() public {
        uint256 realised = _bareRealised();
        _setRef(uint128(realised), 10, 0, 0, uint128(BALANCE_A));
        harness.run(_bandProgram(10), _setup(true, AMOUNT_IN, true)); // must not revert
    }

    function test_RejectsFillFarAboveReferenceMid() public {
        uint256 realised = _bareRealised();
        // mid half the realised rate: the maker would be buying A far above reference.
        _setRef(uint128(realised / 2), 0, 0, 0, uint128(BALANCE_A));
        vm.expectRevert();
        harness.run(_bandProgram(0), _setup(true, AMOUNT_IN, true));
    }

    function test_RejectsFillFarBelowReferenceMid_OtherDirection() public {
        // taker pays B, receives A => maker SELLS A, wants a HIGH rate; a mid far above the realised
        // rate must trip the floor branch.
        (uint256 amountIn, uint256 amountOut) = harness.run(XYCSwap.build(), _setup(true, AMOUNT_IN, false));
        uint256 realised = amountIn * 1e18 / amountOut;
        _setRef(uint128(realised * 2), 0, 0, 0, uint128(BALANCE_A));
        vm.expectRevert();
        harness.run(_bandProgram(0), _setup(true, AMOUNT_IN, false));
    }

    // ---------------------------------------------------------------------
    // bandEdgeBps: the slow workflow's published boundary, able to TIGHTEN only
    // ---------------------------------------------------------------------

    /// @dev The published boundary is the reason the slow workflow exists, and until now nothing read
    ///      it. It is applied as `min(immediate maxTiltBps, r.bandEdgeBps)`, never as a replacement:
    ///      the maker signed a cap and a later publisher must not be able to widen it. Tightening is
    ///      safe in the other direction — it only ever refuses more fills.
    ///
    ///      Setup: raw tilt is at the full immediate cap, and the realised rate sits inside the band
    ///      that cap earns but outside the band a tightened cap earns.
    function test_BandEdgeTightensTheCap() public {
        uint256 realised = _bareRealised();
        uint128 mid = uint128(realised * 10_000 / 10_300); // realised ~3% above mid

        // Full cap: band = |tilt| 500bps = 5% > 3% => admitted.
        _setRef(mid, 0, int16(int256(uint256(MAX_TILT_BPS))), 0, uint128(BALANCE_A), MAX_TILT_BPS);
        harness.run(_bandProgram(0), _setup(true, AMOUNT_IN, true));

        // Tightened to 100bps: band = 1% < 3% => the same fill must now be refused.
        _setRef(mid, 0, int16(int256(uint256(MAX_TILT_BPS))), 0, uint128(BALANCE_A), 100);
        vm.expectRevert();
        harness.run(_bandProgram(0), _setup(true, AMOUNT_IN, true));
    }

    /// @dev The security property: a published edge WIDER than the maker's immediate is ignored.
    function test_BandEdgeCannotLoosenTheCap() public {
        uint256 realised = _bareRealised();
        uint128 mid = uint128(realised * 10_000 / 10_600); // realised ~6% above mid, outside a 5% cap

        _setRef(mid, 0, int16(int256(uint256(MAX_TILT_BPS))), 0, uint128(BALANCE_A), 9_000);
        vm.expectRevert();
        harness.run(_bandProgram(0), _setup(true, AMOUNT_IN, true));
    }

    /// @dev Zero means "no opinion published yet", NOT "clamp the tilt to nothing". Every reference
    ///      written before the slow workflow existed carries a zero here, and reading it as a cap
    ///      would collapse the band on every one of them.
    function test_BandEdgeZeroLeavesTheImmediateCapInForce() public {
        uint256 realised = _bareRealised();
        uint128 mid = uint128(realised * 10_000 / 10_300); // realised ~3% above mid

        _setRef(mid, 0, int16(int256(uint256(MAX_TILT_BPS))), 0, uint128(BALANCE_A), 0);
        harness.run(_bandProgram(0), _setup(true, AMOUNT_IN, true)); // must not revert
    }

    // ---------------------------------------------------------------------
    // 3.7 — the band must widen by the SAME effective tilt ZentisSkew priced with
    // ---------------------------------------------------------------------

    /// @dev The discriminating case: a reference whose raw `tiltBps` is 0 but whose *effective* tilt
    ///      is +400bps once extrapolated to live inventory. The mid is tuned so the realised rate sits
    ///      2% above it — inside the 4% band the effective tilt earns, but outside the 0% band raw
    ///      `tiltBps` would give. Correct code admits the fill; code that read `r.tiltBps` rejects it.
    function test_BandUsesSameTiltAsSkew() public {
        uint256 realised = _bareRealised();
        uint128 mid = uint128(realised * 10_000 / 10_200); // realised sits ~2% above mid

        // tiltBps = 0, but liveA is 400 units above refBalanceA at 1bp/unit => effectiveTilt = +400.
        _setRef(mid, 0, 0, 1e18, uint128(BALANCE_A - 400));

        // Sanity: the effective tilt really is what widens the band. Raw tilt is zero, so a
        // zero-tolerance band computed off raw tiltBps would have width 0 and reject.
        harness.run(_bandProgram(0), _setup(true, AMOUNT_IN, true)); // must not revert
    }

    /// @dev The end-to-end invariant the duplication of maxTiltBps exists to protect: a program that
    ///      skews and then bands must never reject the very fill its own skew priced.
    function testFuzz_BandNeverRejectsItsOwnSkewedFill(int16 tiltBps, uint256 amountIn, uint16 bandEdgeBps)
        public
    {
        tiltBps = int16(bound(int256(tiltBps), -int256(uint256(MAX_TILT_BPS)), int256(uint256(MAX_TILT_BPS))));
        amountIn = bound(amountIn, 1e15, 10_000e18);
        // A published edge anywhere from "nothing published" to wider than the immediate cap. The
        // invariant has to survive all of it: whatever tightens the band must tighten the pricing
        // tilt too, or the band starts refusing fills its own skew produced.
        bandEdgeBps = uint16(bound(bandEdgeBps, 0, 2 * MAX_TILT_BPS));

        uint256 realised = _bareRealised();
        _setRef(uint128(realised), 10, tiltBps, 0, uint128(BALANCE_A), bandEdgeBps);

        // ZentisBand wraps ZentisSkew wraps the curve — the production nesting order.
        bytes memory program = bytes.concat(
            ZentisBand.build(address(ref), POSITION_ID, 50, MAX_TILT_BPS),
            ZentisSkew.build(address(ref), POSITION_ID, MAX_STALENESS, MAX_TILT_BPS, 0, 0),
            XYCSwap.build()
        );

        harness.run(program, _setup(true, amountIn, true)); // must not revert
    }

    /// @dev The backstop for the recompute guard's blind spot: two ZentisSkew instructions before the
    ///      curve compound their multipliers without tripping that guard (see
    ///      ZentisSkew.t.sol's test_RecomputeGuard_DoesNotCatchDoubleSkewBeforeTheCurve), but the band
    ///      is computed from a *single* effective tilt, so the compounded quote falls outside it.
    function test_BandCatchesCompoundedDoubleSkew() public {
        uint256 realised = _bareRealised();
        _setRef(uint128(realised), 10, -300, 0, uint128(BALANCE_A));

        bytes memory band = ZentisBand.build(address(ref), POSITION_ID, 50, MAX_TILT_BPS);
        bytes memory skew = ZentisSkew.build(address(ref), POSITION_ID, MAX_STALENESS, MAX_TILT_BPS, 0, 0);

        // One skew: inside the band.
        harness.run(bytes.concat(band, skew, XYCSwap.build()), _setup(true, AMOUNT_IN, true));

        // Two: the shift compounds past what a single effective tilt admits.
        vm.expectRevert();
        harness.run(bytes.concat(band, skew, skew, XYCSwap.build()), _setup(true, AMOUNT_IN, true));
    }

    // ---------------------------------------------------------------------
    // guards
    // ---------------------------------------------------------------------

    function test_RevertsOnZeroAmount() public {
        _setRef(1e18, 10, 0, 0, uint128(BALANCE_A));
        vm.expectRevert(abi.encodeWithSelector(ZentisBand.ZentisZeroAmount.selector, 0, 0));
        harness.run(_bandProgram(10), _setup(true, 0, true));
    }

    function test_RevertsWhenBandReachesFullWidth() public {
        _setRef(1e18, 9_000, 0, 0, uint128(BALANCE_A));
        vm.expectRevert(abi.encodeWithSelector(ZentisBand.ZentisBandTooWide.selector, 10_000));
        harness.run(_bandProgram(1_000), _setup(true, AMOUNT_IN, true));
    }

    // ---------------------------------------------------------------------
    // a wider band is strictly more permissive
    // ---------------------------------------------------------------------

    function test_WiderToleranceAdmitsWhatNarrowerRejects() public {
        uint256 realised = _bareRealised();
        _setRef(uint128(realised * 10_000 / 10_200), 0, 0, 0, uint128(BALANCE_A)); // realised ~2% above mid

        vm.expectRevert();
        harness.run(_bandProgram(100), _setup(true, AMOUNT_IN, true)); // 1% tolerance: too tight

        harness.run(_bandProgram(300), _setup(true, AMOUNT_IN, true)); // 3% tolerance: admits it
    }
}
