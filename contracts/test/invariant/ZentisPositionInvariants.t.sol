// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {Aqua} from "@1inch/aqua/src/Aqua.sol";
import {TokenCustomDecimalsMock} from "@1inch/solidity-utils/contracts/mocks/TokenCustomDecimalsMock.sol";

import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {SwapVM} from "swap-vm/SwapVM.sol";
import {MakerTraitsLib} from "swap-vm/libs/MakerTraits.sol";
import {TakerTraitsLib} from "swap-vm/libs/TakerTraits.sol";

import {CoreInvariants} from "../../lib/swap-vm/test/invariants/CoreInvariants.t.sol";

import {ZentisPositionConfig} from "../../script/ZentisPositionConfig.sol";
import {ZentisRefRegistry} from "../../src/ref/ZentisRefRegistry.sol";
import {ZentisRef} from "../../src/ref/IZentisRef.sol";
import {ZentisRouter} from "../../src/routers/ZentisRouter.sol";
import {ZentisStrategies} from "../../src/strategies/ZentisStrategies.sol";
import {ZentisStrategiesHarness} from "../fixtures/ZentisStrategiesHarness.sol";

/// @notice The shipped Zentis program, put through SwapVM's own CoreInvariants.
///
///         Three custom instructions sit between the taker and the curve, and each of them changes
///         the amounts: `ZentisSkew` mutates `balanceIn` before the curve prices, `ZentisSpread`
///         shrinks `amountIn` before that, and `ZentisBand` refuses the whole swap outside its
///         bounds. Any of those could break a property the venue relies on -- that quoting a swap
///         and executing it agree, that exact-in and exact-out are two views of one trade, that a
///         larger trade never gets a better price, that rounding never favours the taker. The unit
///         tests check each instruction's arithmetic; this checks the assembled program against the
///         venue's own definition of correct, which is the check a taker actually depends on.
///
///         The parameters come from `ZentisPositionConfig`, the same library the ship and fill
///         scripts build from, so this exercises the program that is deployed rather than a
///         convenient one. Changing a live parameter re-runs these invariants against the new value.
contract ZentisPositionInvariantsTest is Test, CoreInvariants {
    Aqua internal aqua;
    ZentisRouter internal router;
    ZentisRefRegistry internal registry;
    ZentisStrategiesHarness internal builder;

    TokenCustomDecimalsMock internal tokenA; // USDC-shaped, 6dp
    TokenCustomDecimalsMock internal tokenB; // WETH-shaped, 18dp

    address internal maker = address(0xA11CE);
    address internal taker = address(0xB0B);

    bytes32 internal constant POSITION_ID = bytes32(uint256(1));

    /// @dev The live shape as of 2026-09-11: 15 USDC a leg, and a mid of 4.05e26 raw B per 1e18 raw
    ///      A -- ETH around $2,470, which is what the mainnet market was publishing. `BALANCE_B` is
    ///      derived from the mid rather than written down, because the band compares the curve's own
    ///      rate against the reference and an even leg is the state a re-ship produces.
    uint256 internal constant LIVE_A = 15e6;
    uint128 internal constant MID = 405_000_000_000_000_000_000_000_000;

    /// @dev A second, deeper leg, used only where the invariant's own probe demands it.
    ///      `assertRoundingFavorsMakerInvariant` fixes its probe at ONE WHOLE TOKEN and compares the
    ///      rate for 1-1000 wei against it. Against the live leg that probe is 1 USDC into 15 USDC --
    ///      6.7% of the reserve, so the "spot price" it measures is the curve's price impact rather
    ///      than its rounding, and on the tokenB side one whole WETH is 165x the entire leg. The
    ///      check is sound and the fixture was wrong for it: at a million USDC the probe is
    ///      negligible and the invariant measures what it says it does. Same program, same
    ///      parameters, deeper book.
    uint256 internal constant DEEP_A = 1_000_000e6;

    function _balanceB(uint256 balanceA) internal pure returns (uint256) {
        return (balanceA * MID) / 1e18;
    }

    uint32 internal seq;

    function setUp() public {
        aqua = new Aqua();
        router = new ZentisRouter(address(aqua), address(0), address(this));
        registry = new ZentisRefRegistry(address(this), address(this), address(0), 0, 0);
        builder = new ZentisStrategiesHarness();

        _deploySortedPair();

        tokenA.mint(maker, 1_000_000e6);
        tokenB.mint(maker, 1_000e18);
        tokenA.mint(taker, 1_000_000e6);
        tokenB.mint(taker, 1_000e18);

        vm.startPrank(maker);
        tokenA.approve(address(aqua), type(uint256).max);
        tokenB.approve(address(aqua), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(taker);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        vm.stopPrank();

        vm.warp(1_800_000_000);
        _setRef(0, 0);
    }

    /// @dev MakerTraits requires tokenA < tokenB and the decimals are fixed at construction, so the
    ///      6-decimal leg has to land on the lower address. Redeploy until it does.
    function _deploySortedPair() private {
        tokenB = new TokenCustomDecimalsMock("Wrapped Ether", "WETH", 0, 18);
        while (true) {
            TokenCustomDecimalsMock candidate = new TokenCustomDecimalsMock("USD Coin", "USDC", 0, 6);
            if (address(candidate) < address(tokenB)) {
                tokenA = candidate;
                break;
            }
        }
    }

    function _setRef(int16 tiltBps, uint16 spreadBps) internal {
        _setRef(tiltBps, spreadBps, LIVE_A);
    }

    function _setRef(int16 tiltBps, uint16 spreadBps, uint256 refBalanceA) internal {
        ZentisRef memory r;
        r.mid = MID;
        r.spreadBps = spreadBps;
        r.tiltBps = tiltBps;
        r.updatedAt = uint40(block.timestamp);
        r.seq = ++seq;
        r.refBalanceA = uint128(refBalanceA);
        r.dTiltPerA = 0;
        r.maxExtrapBps = 0;
        r.bandEdgeBps = ZentisPositionConfig.MAX_TILT_BPS;
        registry.pokeRef(POSITION_ID, r);
    }

    /// @dev Every field but the identity comes from the deployed config.
    function _position() internal view returns (ZentisStrategies.ZentisPosition memory p) {
        p.ref = address(registry);
        p.positionId = POSITION_ID;
        p.deadline = uint40(block.timestamp + 1 days);
        p.chainSalt = uint64(block.chainid);
        p.bandTolBps = ZentisPositionConfig.BAND_TOL_BPS;
        p.floorOutA = ZentisPositionConfig.FLOOR_OUT_A;
        p.floorOutB = ZentisPositionConfig.FLOOR_OUT_B;
        p.spreadMaxWidenBps = ZentisPositionConfig.SPREAD_MAX_WIDEN_BPS;
        p.maxStaleness = ZentisPositionConfig.MAX_STALENESS;
        p.widenBpsPerMinute = ZentisPositionConfig.WIDEN_BPS_PER_MINUTE;
        p.skewMaxWidenBps = ZentisPositionConfig.SKEW_MAX_WIDEN_BPS;
        p.maxTiltBps = ZentisPositionConfig.MAX_TILT_BPS;
    }

    function _ship(uint256 balanceA) internal returns (ISwapVM.Order memory order) {
        MakerTraitsLib.Args memory args;
        args.maker = maker;
        args.tokenA = address(tokenA);
        args.tokenB = address(tokenB);
        args.useAquaInsteadOfSignature = true;
        bytes[] memory prefix = new bytes[](0);
        args.program = builder.build(prefix, _position());
        order = MakerTraitsLib.build(args);

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = balanceA;
        amounts[1] = _balanceB(balanceA);

        vm.prank(maker);
        aqua.ship(address(router), abi.encode(order), tokens, amounts);
    }

    function _takerData(bool isExactIn, bool isAToB) internal view returns (bytes memory) {
        TakerTraitsLib.Args memory args;
        args.taker = taker;
        args.isExactIn = isExactIn;
        args.isAToB = isAToB;
        args.isFirstTransferFromTaker = true;
        args.useTransferFromAndAquaPush = true;
        return TakerTraitsLib.build(args);
    }

    /// @inheritdoc CoreInvariants
    /// @dev The taker is an EOA holding both tokens with the router approved, so the router pulls
    ///      `tokenIn` with `transferFrom` and pushes it into Aqua. That is the path a real fill
    ///      takes, which is the point: an invariant proved against a shortcut proves nothing.
    function _executeSwap(
        SwapVM swapVM,
        ISwapVM.Order memory order,
        address,
        address,
        uint256 amount,
        bytes memory takerData
    ) internal override returns (uint256 amountIn, uint256 amountOut) {
        vm.prank(taker);
        (amountIn, amountOut,) = swapVM.swap(order, amount, takerData);
    }

    function _amounts(uint256 a, uint256 b, uint256 c) private pure returns (uint256[] memory out) {
        out = new uint256[](3);
        (out[0], out[1], out[2]) = (a, b, c);
    }

    /// @dev One raw unit of the 6-decimal token, valued in the 18-decimal one. Nothing finer than
    ///      this can be expressed on the tokenA side, so a round trip through tokenA cannot come back
    ///      more precisely than this however exact the arithmetic is. The base class's default
    ///      tolerance of "2 wei" is the right number for an 18/18 pair and meaningless for 6/18.
    uint256 internal constant ONE_A_IN_B = MID / 1e18;

    /// @dev Trade sizes scale with the leg so the same fraction of the book is tested at both depths.
    ///      One ten-thousandth up to one per cent: the recorded on-chain fill was 0.15 USDC against a
    ///      15 USDC leg, which is the top of that range.
    function _config(bool isAToB, uint256 balanceA) internal view returns (InvariantConfig memory config) {
        uint256 b = _balanceB(balanceA);
        uint256[] memory inA = _amounts(balanceA / 10_000, balanceA / 1_000, balanceA / 100);
        uint256[] memory inB = _amounts(b / 10_000, b / 1_000, b / 100);

        // Symmetry compares amounts of whichever token the round trip returns, so the floor on its
        // precision is that token's own granularity: two raw units either way.
        config = createInvariantConfig(isAToB ? inA : inB, isAToB ? 2 : 2 * ONE_A_IN_B);
        config.testAmountsExactOut = isAToB ? inB : inA;
        config.exactInTakerData = _takerData(true, isAToB);
        config.exactOutTakerData = _takerData(false, isAToB);
    }

    // ---------------------------------------------------------------------
    // the venue's own definition of correct, applied to the shipped program
    // ---------------------------------------------------------------------

    function test_CoreInvariants_AToB() public {
        _setRef(0, 0, DEEP_A);
        ISwapVM.Order memory order = _ship(DEEP_A);
        assertAllInvariantsWithConfig(router, order, address(tokenA), address(tokenB), _config(true, DEEP_A));
    }

    function test_CoreInvariants_BToA() public {
        _setRef(0, 0, DEEP_A);
        ISwapVM.Order memory order = _ship(DEEP_A);
        assertAllInvariantsWithConfig(router, order, address(tokenB), address(tokenA), _config(false, DEEP_A));
    }

    /// @dev A tilt is the whole point of the position and the one input the unit tests cannot prove
    ///      safe in combination: it mutates `balanceIn` before the curve prices, so it moves every
    ///      amount the invariants are stated over. Additivity is asserted separately below, because
    ///      the skew makes it hold only to a bound rather than exactly.
    function test_CoreInvariants_UnderTilt() public {
        _setRef(-400, 12, DEEP_A);
        ISwapVM.Order memory order = _ship(DEEP_A);

        InvariantConfig memory toB = _config(true, DEEP_A);
        InvariantConfig memory toA = _config(false, DEEP_A);
        toB.skipAdditivity = true;
        toA.skipAdditivity = true;

        assertAllInvariantsWithConfig(router, order, address(tokenA), address(tokenB), toB);
        assertAllInvariantsWithConfig(router, order, address(tokenB), address(tokenA), toA);
    }

    /// @notice Splitting a trade must not pay, beyond the bound the skew makes unavoidable.
    ///
    /// @dev Additivity is exact on a plain constant-product curve: swap(a) then swap(b) leaves the
    ///      book exactly where swap(a+b) does. `ZentisSkew` breaks that, and it is worth being
    ///      precise about why rather than skipping the check. The skew scales the maker's `balanceIn`
    ///      by (1 + k) on every call, while the taker's amount enters unscaled, so after a first fill
    ///      of `d1` the effective reserve is `(A + d1)(1 + k)` rather than `A(1 + k) + d1`. The two
    ///      differ by `k * d1`, which is why a split trade prices marginally differently from a whole
    ///      one. The difference is first-order in the tilt and in the fill's share of the book, so it
    ///      is bounded rather than exploitable -- and this asserts that bound rather than trusting it.
    ///      swap-vm's own suite skips additivity for the same class of reason (`FeeFlatOut`).
    function test_SplittingATradeIsNotWorthIt() public {
        _setRef(-400, 12, DEEP_A);
        ISwapVM.Order memory order = _ship(DEEP_A);

        uint256 half = DEEP_A / 2_000;
        bytes memory takerData = _takerData(true, true);

        uint256 snap = vm.snapshot();
        (, uint256 whole) = _executeSwap(router, order, address(tokenA), address(tokenB), 2 * half, takerData);
        vm.revertTo(snap);

        snap = vm.snapshot();
        (, uint256 first) = _executeSwap(router, order, address(tokenA), address(tokenB), half, takerData);
        (, uint256 second) = _executeSwap(router, order, address(tokenA), address(tokenB), half, takerData);
        vm.revertTo(snap);

        uint256 split = first + second;
        assertGt(split, 0, "the split trade produced nothing");
        if (split <= whole) return; // splitting cost the taker, which needs no bound

        // The edge a splitter could capture, in HUNDREDTHS of a basis point of the whole-trade
        // output. Measured at that resolution on purpose: the real figure here is about a tenth of a
        // basis point, which truncates to zero in whole bps and would let the bound pass without
        // ever stating a number. One basis point is already an order of magnitude under the
        // published half-spread, so an edge this size cannot pay for the second transaction's gas,
        // let alone for the spread it crosses.
        uint256 edgeHundredthsBps = ((split - whole) * 1_000_000) / whole;
        assertLt(edgeHundredthsBps, 100, "splitting a trade earns more than a basis point");
    }

    // ---------------------------------------------------------------------
    // quote/swap parity, stated on its own because the console depends on it
    // ---------------------------------------------------------------------

    /// @dev Everything a reader sees before trading -- the console's quotes, `services/quote-api`,
    ///      the band refusal it decodes -- comes from `quote()`, while the money moves through
    ///      `swap()`. If the two disagree the product lies to its user. Asserted at the LIVE depth,
    ///      because this is the one property that must hold for the book as it is actually shipped.
    function test_QuoteMatchesSwap_BothDirections() public {
        ISwapVM.Order memory order = _ship(LIVE_A);

        uint256[] memory inA = _amounts(0.01e6, 0.05e6, 0.15e6);
        for (uint256 i; i < inA.length; i++) {
            assertQuoteSwapConsistencyInvariant(
                router, order, address(tokenA), address(tokenB), inA[i], _takerData(true, true)
            );
        }

        uint256[] memory inB = _amounts(4e12, 2e13, 6e13);
        for (uint256 i; i < inB.length; i++) {
            assertQuoteSwapConsistencyInvariant(
                router, order, address(tokenB), address(tokenA), inB[i], _takerData(true, false)
            );
        }
    }

    function test_QuoteMatchesSwap_UnderTilt() public {
        _setRef(-400, 12);
        ISwapVM.Order memory order = _ship(LIVE_A);
        assertQuoteSwapConsistencyInvariant(
            router, order, address(tokenA), address(tokenB), 0.05e6, _takerData(true, true)
        );
        assertQuoteSwapConsistencyInvariant(
            router, order, address(tokenB), address(tokenA), 2e13, _takerData(true, false)
        );
    }
}
