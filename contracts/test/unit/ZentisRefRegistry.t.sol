// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ZentisRefRegistry} from "../../src/ref/ZentisRefRegistry.sol";
import {ZentisRef} from "../../src/ref/IZentisRef.sol";
import {MockAggregatorV3} from "../fixtures/MockAggregatorV3.sol";

contract ZentisRefRegistryTest is Test {
    address internal constant FORWARDER = address(0xF0F0);
    address internal owner;
    bytes32 internal constant POSITION_ID = bytes32(uint256(1));

    ZentisRefRegistry internal registryNoFeed;
    ZentisRefRegistry internal registryWithFeed;
    MockAggregatorV3 internal feed;

    // FEED_SCALE = 1e18 => feedMid == the mock's raw answer, so tests can pick round numbers.
    uint256 internal constant FEED_SCALE = 1e18;
    uint16 internal constant FEED_BAND_BPS = 500;

    function setUp() public {
        owner = address(this);
        registryNoFeed = new ZentisRefRegistry(FORWARDER, owner, address(0), FEED_BAND_BPS, FEED_SCALE);

        feed = new MockAggregatorV3(1_000e8);
        registryWithFeed =
            new ZentisRefRegistry(FORWARDER, owner, address(feed), FEED_BAND_BPS, FEED_SCALE);
    }

    function _ref(uint128 mid, uint32 seq, uint40 updatedAt) private pure returns (ZentisRef memory r) {
        r.mid = mid;
        r.spreadBps = 10;
        r.tiltBps = 0;
        r.updatedAt = updatedAt;
        r.seq = seq;
    }

    // ---------------------------------------------------------------------
    // constructor
    // ---------------------------------------------------------------------

    function test_Constructor_RevertsOnZeroForwarder() public {
        vm.expectRevert();
        new ZentisRefRegistry(address(0), owner, address(0), FEED_BAND_BPS, FEED_SCALE);
    }

    // ---------------------------------------------------------------------
    // pokeRef access control
    // ---------------------------------------------------------------------

    function test_PokeRef_OnlyOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(ZentisRefRegistry.ZentisRefNotOwner.selector);
        registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, 1, uint40(block.timestamp)));
    }

    function test_PokeRef_DisabledAfterGoLive() public {
        registryNoFeed.goLive();
        vm.expectRevert(ZentisRefRegistry.ZentisRefCreIsLive.selector);
        registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, 1, uint40(block.timestamp)));
    }

    function test_GoLive_OnlyOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(ZentisRefRegistry.ZentisRefNotOwner.selector);
        registryNoFeed.goLive();
    }

    // ---------------------------------------------------------------------
    // write guards
    // ---------------------------------------------------------------------

    function test_PokeRef_WritesAndEmits() public {
        ZentisRef memory r = _ref(1e18, 1, uint40(block.timestamp));

        vm.expectEmit(true, false, false, true, address(registryNoFeed));
        emit ZentisRefRegistry.ZentisRefUpdated(POSITION_ID, r.mid, r.tiltBps, r.updatedAt, r.seq);
        registryNoFeed.pokeRef(POSITION_ID, r);

        ZentisRef memory stored = registryNoFeed.refOf(POSITION_ID);
        assertEq(stored.mid, r.mid);
        assertEq(stored.seq, r.seq);
    }

    function test_PokeRef_RevertsOnStaleSeq() public {
        registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, 5, uint40(block.timestamp)));

        vm.expectRevert(abi.encodeWithSelector(ZentisRefRegistry.ZentisRefStaleSeq.selector, 5, 5));
        registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, 5, uint40(block.timestamp)));
    }

    function test_PokeRef_RevertsOnFutureTimestamp() public {
        vm.expectRevert(
            abi.encodeWithSelector(ZentisRefRegistry.ZentisRefBadTimestamp.selector, uint40(block.timestamp + 1))
        );
        registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, 1, uint40(block.timestamp + 1)));
    }

    function test_PokeRef_RevertsOnTimestampGoingBackwards() public {
        // Drive timestamps from literals passed to vm.warp, never from a second in-test read of
        // block.timestamp: this via-ir build caches the first block.timestamp read across an
        // intervening external call, so a later `block.timestamp` in the same test function can
        // return a stale value. The registry's own read (a fresh call frame) is unaffected.
        uint40 t0 = 1_000;
        vm.warp(t0);
        registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, 1, t0));

        uint40 t1 = t0 + 100;
        vm.warp(t1);
        registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, 2, t1));

        vm.expectRevert(abi.encodeWithSelector(ZentisRefRegistry.ZentisRefBadTimestamp.selector, t0));
        registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, 3, t0));
    }

    /// @dev A ref with mid == 0 must never be storable. With the oracle band disabled — the shipped
    ///      configuration on both testnets, and the deploy script's default — nothing else rejects it,
    ///      and ZentisBand then computes `floor = mulDiv(0, ...) == 0`, so `realised >= floor` holds
    ///      for every conceivable fill: the maker-sells-A direction loses its boundary entirely.
    function test_PokeRef_RevertsOnZeroMid() public {
        ZentisRef memory r = _ref(0, 1, uint40(block.timestamp));
        vm.expectRevert(ZentisRefRegistry.ZentisRefZeroMid.selector);
        registryNoFeed.pokeRef(POSITION_ID, r);
    }

    // ---------------------------------------------------------------------
    // oracle band
    // ---------------------------------------------------------------------

    function test_OracleBand_DisabledWhenFeedIsZeroAddress() public {
        // Wildly divergent mid still accepted — no feed configured for this leg.
        registryNoFeed.pokeRef(POSITION_ID, _ref(1, 1, uint40(block.timestamp)));
        assertEq(registryNoFeed.refOf(POSITION_ID).mid, 1);
    }

    function test_OracleBand_AcceptsMidWithinBand() public {
        // feed answer 1_000e8 * FEED_SCALE(1e18) / 1e18 = 1_000e8 => feedMid = 1_000e8.
        // 1% inside the 5% (500bps) band.
        uint128 mid = uint128(1_000e8 + (1_000e8 * 100) / 10_000);
        registryWithFeed.pokeRef(POSITION_ID, _ref(mid, 1, uint40(block.timestamp)));
        assertEq(registryWithFeed.refOf(POSITION_ID).mid, mid);
    }

    function test_OracleBand_RejectsMidOutsideBand_WithoutReverting_LeavesPriorRef() public {
        ZentisRef memory first = _ref(uint128(1_000e8), 1, uint40(block.timestamp));
        registryWithFeed.pokeRef(POSITION_ID, first);

        // 10% away from feedMid — outside the 5% band.
        uint128 badMid = uint128(1_000e8 + (1_000e8 * 1_000) / 10_000);
        ZentisRef memory second = _ref(badMid, 2, uint40(block.timestamp));

        vm.expectEmit(true, false, false, true, address(registryWithFeed));
        emit ZentisRefRegistry.ZentisRefRejected(POSITION_ID, "mid outside oracle band");
        registryWithFeed.pokeRef(POSITION_ID, second);

        // Not reverted (this call itself succeeded), but the ref did not advance.
        ZentisRef memory stored = registryWithFeed.refOf(POSITION_ID);
        assertEq(stored.mid, first.mid);
        assertEq(stored.seq, first.seq);
    }

    function test_OracleBand_NonPositiveFeedAnswer_RejectsWithoutReverting() public {
        feed.setAnswer(0);
        registryWithFeed.pokeRef(POSITION_ID, _ref(uint128(1_000e8), 1, uint40(block.timestamp)));

        // seq did not advance because the write was skipped.
        assertEq(registryWithFeed.refOf(POSITION_ID).seq, 0);
    }

    // ---------------------------------------------------------------------
    // onReport (CRE forwarder path)
    // ---------------------------------------------------------------------

    function test_OnReport_OnlyForwarderCanCall() public {
        bytes memory report = abi.encode(POSITION_ID, _ref(1e18, 1, uint40(block.timestamp)));
        vm.expectRevert();
        registryNoFeed.onReport("", report);
    }

    function test_OnReport_FromForwarder_Writes() public {
        ZentisRef memory r = _ref(1e18, 1, uint40(block.timestamp));
        bytes memory report = abi.encode(POSITION_ID, r);

        vm.prank(FORWARDER);
        registryNoFeed.onReport("", report);

        assertEq(registryNoFeed.refOf(POSITION_ID).mid, r.mid);
    }

    /// @dev A report the DON must not retry has to be rejected, not reverted. `IReceiver.onReport`'s
    ///      contract is that a revert means "transient failure, try again" — so reverting on a
    ///      condition that can never clear (a replayed seq, a report that predates the stored one,
    ///      a malformed zero mid) asks the DON to retry the same doomed report forever, and rolls
    ///      back the very event that would have made the rejection visible. The oracle band was
    ///      already written this way; these three guards were not, and replay is by far the likeliest
    ///      of them in practice.
    ///
    ///      `pokeRef` keeps reverting on all three: it is an interactive owner call, where a caller
    ///      wants the error and there is no retry loop to poison.

    function test_OnReport_StaleSeq_RejectsWithoutReverting() public {
        ZentisRef memory first = _ref(1e18, 5, uint40(block.timestamp));
        registryNoFeed.pokeRef(POSITION_ID, first);

        bytes memory replay = abi.encode(POSITION_ID, _ref(2e18, 5, uint40(block.timestamp)));
        vm.expectEmit(true, false, false, true, address(registryNoFeed));
        emit ZentisRefRegistry.ZentisRefRejected(POSITION_ID, "stale seq");
        vm.prank(FORWARDER);
        registryNoFeed.onReport("", replay);

        ZentisRef memory stored = registryNoFeed.refOf(POSITION_ID);
        assertEq(stored.mid, first.mid, "a rejected report must leave the prior ref in place");
        assertEq(stored.seq, first.seq);
    }

    function test_OnReport_ZeroMid_RejectsWithoutReverting() public {
        bytes memory report = abi.encode(POSITION_ID, _ref(0, 1, uint40(block.timestamp)));
        vm.expectEmit(true, false, false, true, address(registryNoFeed));
        emit ZentisRefRegistry.ZentisRefRejected(POSITION_ID, "zero mid");
        vm.prank(FORWARDER);
        registryNoFeed.onReport("", report);

        assertEq(registryNoFeed.refOf(POSITION_ID).seq, 0, "nothing may be stored");
    }

    function test_OnReport_TimestampGoingBackwards_RejectsWithoutReverting() public {
        uint40 t0 = 1_000;
        vm.warp(t0);
        registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, 1, t0));

        uint40 t1 = t0 + 100;
        vm.warp(t1);
        registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, 2, t1));

        bytes memory report = abi.encode(POSITION_ID, _ref(1e18, 3, t0));
        vm.expectEmit(true, false, false, true, address(registryNoFeed));
        emit ZentisRefRegistry.ZentisRefRejected(POSITION_ID, "bad timestamp");
        vm.prank(FORWARDER);
        registryNoFeed.onReport("", report);

        assertEq(registryNoFeed.refOf(POSITION_ID).seq, 2, "the good ref must survive");
    }

    /// @dev The mirror of the three above: the owner path must still fail loudly.
    function test_PokeRef_StillRevertsWhereOnReportRejects() public {
        registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, 5, uint40(block.timestamp)));
        vm.expectRevert(abi.encodeWithSelector(ZentisRefRegistry.ZentisRefStaleSeq.selector, 5, 5));
        registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, 5, uint40(block.timestamp)));
    }

    function testFuzz_PokeRef_SeqMustStrictlyIncrease(uint32 seq1, uint32 seq2) public {
        vm.assume(seq1 > 0);
        registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, seq1, uint40(block.timestamp)));

        if (seq2 > seq1) {
            registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, seq2, uint40(block.timestamp)));
            assertEq(registryNoFeed.refOf(POSITION_ID).seq, seq2);
        } else {
            vm.expectRevert(abi.encodeWithSelector(ZentisRefRegistry.ZentisRefStaleSeq.selector, seq2, seq1));
            registryNoFeed.pokeRef(POSITION_ID, _ref(1e18, seq2, uint40(block.timestamp)));
        }
    }
}
