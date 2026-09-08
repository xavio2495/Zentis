// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {Aqua} from "@1inch/aqua/src/Aqua.sol";
import {TokenCustomDecimalsMock} from "@1inch/solidity-utils/contracts/mocks/TokenCustomDecimalsMock.sol";

import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {MakerTraitsLib} from "swap-vm/libs/MakerTraits.sol";
import {TakerTraitsLib} from "swap-vm/libs/TakerTraits.sol";

import {ZentisRouter} from "../../src/routers/ZentisRouter.sol";
import {ZentisRefRegistry} from "../../src/ref/ZentisRefRegistry.sol";
import {ZentisRef} from "../../src/ref/IZentisRef.sol";
import {ZentisStrategies} from "../../src/strategies/ZentisStrategies.sol";
import {ZentisStrategiesHarness} from "../fixtures/ZentisStrategiesHarness.sol";

/// @notice The Day 4 gate, locally: the vetted recipe, shipped to a real Aqua and filled through a
///         real ZentisRouter. Every test above this one runs the program with Aqua's settlement
///         layer stubbed out; this file is the first that does not.
///
///         The pair deliberately mirrors the live one — tokenA is 6-decimal USDC-shaped, tokenB is
///         18-decimal WETH-shaped — because a symmetric pair is what hid the direction-blind
///         `floorOut` bug in review.
contract ZentisPositionTest is Test {
    Aqua internal aqua;
    ZentisRouter internal router;
    ZentisRefRegistry internal registry;
    ZentisStrategiesHarness internal builder;

    TokenCustomDecimalsMock internal tokenA; // USDC-shaped, 6dp
    TokenCustomDecimalsMock internal tokenB; // WETH-shaped, 18dp

    address internal maker = address(0xA11CE);
    address internal taker = address(0xB0B);

    bytes32 internal constant POSITION_ID = bytes32(uint256(1));

    // 10 USDC against 0.005 WETH: the curve's implied rate is 5e26 raw B per 1e18 raw A, i.e. ETH at
    // $2000, which is the rate the reference below publishes. The band compares the two, so they
    // have to agree at ship time.
    uint256 internal constant BALANCE_A = 10e6;
    uint256 internal constant BALANCE_B = 0.005e18;
    uint128 internal constant MID = 5e26;

    uint16 internal constant MAX_TILT_BPS = 500;
    uint16 internal constant BAND_TOL_BPS = 500;

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

    /// @dev MakerTraits requires tokenA < tokenB, and the decimals are baked in at construction, so
    ///      the 6-decimal leg has to land on the lower address. Redeploy until it does.
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

    /// @dev The registry demands a strictly increasing `seq`, so a test that republishes the
    ///      reference has to advance it — the same discipline the workflow will follow.
    uint32 internal seq;

    function _setRef(int16 tiltBps, uint16 spreadBps) internal {
        ZentisRef memory r;
        r.mid = MID;
        r.spreadBps = spreadBps;
        r.tiltBps = tiltBps;
        r.updatedAt = uint40(block.timestamp);
        r.seq = ++seq;
        r.refBalanceA = uint128(BALANCE_A);
        r.dTiltPerA = 0;
        r.maxExtrapBps = 0;
        registry.pokeRef(POSITION_ID, r);
    }

    function _position() internal view returns (ZentisStrategies.ZentisPosition memory p) {
        p.ref = address(registry);
        p.positionId = POSITION_ID;
        p.deadline = uint40(block.timestamp + 1 days);
        p.chainSalt = uint64(block.chainid);
        p.bandTolBps = BAND_TOL_BPS;
        p.floorOutA = 2e6; // 2 USDC
        p.floorOutB = 0.001e18; // 0.001 WETH
        p.spreadMaxWidenBps = 200;
        p.maxStaleness = 1 hours;
        p.widenBpsPerMinute = 10;
        p.skewMaxWidenBps = 200;
        p.maxTiltBps = MAX_TILT_BPS;
    }

    function _order(bytes memory program) internal view returns (ISwapVM.Order memory) {
        MakerTraitsLib.Args memory args;
        args.maker = maker;
        args.tokenA = address(tokenA);
        args.tokenB = address(tokenB);
        args.useAquaInsteadOfSignature = true;
        args.program = program;
        return MakerTraitsLib.build(args);
    }

    function _ship() internal returns (ISwapVM.Order memory order, bytes32 strategyHash) {
        bytes[] memory prefix = new bytes[](0);
        order = _order(builder.build(prefix, _position()));

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = BALANCE_A;
        amounts[1] = BALANCE_B;

        vm.prank(maker);
        strategyHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);
        assertEq(strategyHash, router.hash(order), "strategyHash must equal the order hash");
    }

    /// @dev An EOA taker: the router pulls tokenIn with transferFrom and pushes it into Aqua, so no
    ///      taker callback contract is needed. This is the path the on-chain fill takes.
    function _takerData(bool isExactIn, bool isAToB) internal view returns (bytes memory) {
        TakerTraitsLib.Args memory args;
        args.taker = taker;
        args.isExactIn = isExactIn;
        args.isAToB = isAToB;
        args.isFirstTransferFromTaker = true;
        args.useTransferFromAndAquaPush = true;
        return TakerTraitsLib.build(args);
    }

    function _quote(ISwapVM.Order memory order, uint256 amount, bool isExactIn, bool isAToB)
        internal
        view
        returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut,) = router.asView().quote(order, amount, _takerData(isExactIn, isAToB));
    }

    function _swap(ISwapVM.Order memory order, uint256 amount, bool isExactIn, bool isAToB)
        internal
        returns (uint256 amountIn, uint256 amountOut)
    {
        vm.prank(taker);
        (amountIn, amountOut,) = router.swap(order, amount, _takerData(isExactIn, isAToB));
    }

    // ---------------------------------------------------------------------
    // the gate: one real fill against a shipped position
    // ---------------------------------------------------------------------

    function test_ShipAndFill_AToB_MovesEveryBalance() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _ship();

        (uint256 makerABefore, uint256 makerBBefore) =
            aqua.safeBalances(maker, address(router), strategyHash, address(tokenA), address(tokenB));
        assertEq(makerABefore, BALANCE_A);
        assertEq(makerBBefore, BALANCE_B);

        uint256 takerABefore = tokenA.balanceOf(taker);
        uint256 takerBBefore = tokenB.balanceOf(taker);

        uint256 amountIn = 1e6; // 1 USDC
        (uint256 filledIn, uint256 filledOut) = _swap(order, amountIn, true, true);

        assertEq(filledIn, amountIn, "exactIn must consume exactly the offered amount");
        assertGt(filledOut, 0, "a fill must pay out");

        assertEq(tokenA.balanceOf(taker), takerABefore - filledIn, "taker paid tokenA");
        assertEq(tokenB.balanceOf(taker), takerBBefore + filledOut, "taker received tokenB");

        (uint256 makerAAfter, uint256 makerBAfter) =
            aqua.safeBalances(maker, address(router), strategyHash, address(tokenA), address(tokenB));
        assertEq(makerAAfter, makerABefore + filledIn, "maker's Aqua tokenA balance grew by amountIn");
        assertEq(makerBAfter, makerBBefore - filledOut, "maker's Aqua tokenB balance shrank by amountOut");
    }

    function test_ShipAndFill_BToA_MovesEveryBalance() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _ship();

        uint256 takerABefore = tokenA.balanceOf(taker);
        uint256 takerBBefore = tokenB.balanceOf(taker);

        uint256 amountIn = 0.0005e18; // 0.0005 WETH
        (uint256 filledIn, uint256 filledOut) = _swap(order, amountIn, true, false);

        assertEq(filledIn, amountIn);
        assertGt(filledOut, 0);
        assertEq(tokenB.balanceOf(taker), takerBBefore - filledIn, "taker paid tokenB");
        assertEq(tokenA.balanceOf(taker), takerABefore + filledOut, "taker received tokenA");

        (uint256 makerAAfter, uint256 makerBAfter) =
            aqua.safeBalances(maker, address(router), strategyHash, address(tokenA), address(tokenB));
        assertEq(makerAAfter, BALANCE_A - filledOut);
        assertEq(makerBAfter, BALANCE_B + filledIn);
    }

    // ---------------------------------------------------------------------
    // 4.3 — quote/swap parity
    // ---------------------------------------------------------------------

    function testFuzz_QuoteSwapParity(uint96 rawAmount, bool isExactIn, bool isAToB, int16 tiltBps)
        public
    {
        tiltBps = int16(bound(tiltBps, -int256(uint256(MAX_TILT_BPS)), int256(uint256(MAX_TILT_BPS))));
        _setRef(tiltBps, 0);
        (ISwapVM.Order memory order,) = _ship();

        // exactIn amounts are denominated in tokenIn, exactOut in tokenOut; both are bounded well
        // inside the position so the fill is neither dust nor a drain.
        uint256 amount = isExactIn == isAToB
            ? bound(rawAmount, 1e4, BALANCE_A / 4)
            : bound(rawAmount, 1e13, BALANCE_B / 4);

        (uint256 quotedIn, uint256 quotedOut) = _quote(order, amount, isExactIn, isAToB);
        (uint256 filledIn, uint256 filledOut) = _swap(order, amount, isExactIn, isAToB);

        assertEq(filledIn, quotedIn, "swap amountIn must equal quote amountIn");
        assertEq(filledOut, quotedOut, "swap amountOut must equal quote amountOut");
    }

    // ---------------------------------------------------------------------
    // the mechanism, end to end: the reference moves the price a taker actually pays
    // ---------------------------------------------------------------------

    function test_TiltMakesTheOverweightTokenCheaperToBuy() public {
        (ISwapVM.Order memory order,) = _ship();
        uint256 amountIn = 0.0005e18; // taker pays tokenB, receives tokenA

        (, uint256 flatOut) = _quote(order, amountIn, true, false);

        // tilt > 0 = over-weight tokenA on this chain => tokenA should be cheaper to buy, i.e. the
        // same tokenB buys MORE tokenA.
        _setRef(int16(int256(uint256(MAX_TILT_BPS))), 0);
        (, uint256 tiltedOut) = _quote(order, amountIn, true, false);
        assertGt(tiltedOut, flatOut, "a positive tilt must discount tokenA for the taker");

        // ...and the mirrored tilt must make it dearer.
        _setRef(-int16(int256(uint256(MAX_TILT_BPS))), 0);
        (, uint256 reverseOut) = _quote(order, amountIn, true, false);
        assertLt(reverseOut, flatOut, "a negative tilt must make tokenA dearer for the taker");
    }

    // ---------------------------------------------------------------------
    // 4.5 — push() tops the position up without a dock and re-ship
    // ---------------------------------------------------------------------

    function test_PushTopsUpInventoryWithoutReship() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _ship();
        _swap(order, 1e6, true, true);

        (uint256 beforeA, uint256 beforeB) =
            aqua.safeBalances(maker, address(router), strategyHash, address(tokenA), address(tokenB));

        uint256 topUp = 0.001e18;
        vm.prank(maker);
        aqua.push(maker, address(router), strategyHash, address(tokenB), topUp);

        (uint256 afterA, uint256 afterB) =
            aqua.safeBalances(maker, address(router), strategyHash, address(tokenA), address(tokenB));
        assertEq(afterA, beforeA, "push of tokenB must not touch tokenA");
        assertEq(afterB, beforeB + topUp, "push must credit the strategy's tokenB balance");

        // and the position keeps quoting on the topped-up inventory, same order, no re-ship
        (, uint256 amountOut) = _swap(order, 1e6, true, true);
        assertGt(amountOut, 0);
    }
}
