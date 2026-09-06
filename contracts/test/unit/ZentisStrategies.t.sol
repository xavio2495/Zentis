// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {Opcode, OpcodeOps} from "swap-vm/libs/OpcodeList.sol";
import {Deadline, Salt} from "swap-vm/instructions/Controls.sol";
import {FeeProtocol} from "swap-vm/instructions/FeeProtocol.sol";
import {XYCSwap} from "swap-vm/instructions/XYCSwap.sol";

import {ZentisStrategies} from "../../src/strategies/ZentisStrategies.sol";
import {ZentisSkew} from "../../src/instructions/ZentisSkew.sol";
import {ZentisSpread} from "../../src/instructions/ZentisSpread.sol";
import {ZentisBand} from "../../src/instructions/ZentisBand.sol";
import {ZentisRef} from "../../src/ref/IZentisRef.sol";
import {MockZentisRef} from "../fixtures/ZentisSkewHarness.sol";
import {ZentisProgramHarness} from "../fixtures/ZentisProgramHarness.sol";
import {ZentisStrategiesHarness} from "../fixtures/ZentisStrategiesHarness.sol";

contract ZentisStrategiesTest is Test {
    using OpcodeOps for Opcode;

    ZentisStrategiesHarness internal builder;
    ZentisProgramHarness internal runner;
    MockZentisRef internal ref;

    address internal constant TOKEN_A = address(0xA);
    address internal constant TOKEN_B = address(0xB);
    address internal constant FEE_RECEIVER = address(0xFEE);
    bytes32 internal constant POSITION_ID = bytes32(uint256(1));

    uint256 internal constant BALANCE_A = 1_000_000e18;
    uint256 internal constant BALANCE_B = 1_000_000e18;
    uint256 internal constant AMOUNT_IN = 1_000e18;

    uint40 internal constant DEADLINE = 2_000_000;
    uint64 internal constant CHAIN_SALT = 84532;
    uint16 internal constant MAX_TILT_BPS = 500;

    function setUp() public {
        builder = new ZentisStrategiesHarness();
        runner = new ZentisProgramHarness();
        ref = new MockZentisRef();
        vm.warp(1_000_000);
    }

    function _args() private view returns (ZentisStrategies.ZentisPosition memory a) {
        a.ref = address(ref);
        a.positionId = POSITION_ID;
        a.deadline = DEADLINE;
        a.chainSalt = CHAIN_SALT;
        a.feeReceiver = FEE_RECEIVER;
        a.feeBps = 30;
        a.feeOnTokenIn = false;
        a.bandTolBps = 50;
        a.floorOutA = 400e18;
        a.floorOutB = 1_800_000e6;
        a.spreadMaxWidenBps = 500;
        a.maxStaleness = 3600;
        a.widenBpsPerMinute = 1;
        a.skewMaxWidenBps = 200;
        a.maxTiltBps = MAX_TILT_BPS;
    }

    // ---------------------------------------------------------------------
    // decoding helpers — a program is a flat concat of [opcode][argsLength][args]
    // ---------------------------------------------------------------------

    function _opcodes(bytes memory program) private pure returns (uint8[] memory out) {
        uint8[] memory scratch = new uint8[](32);
        uint256 n;
        uint256 i;
        while (i < program.length) {
            scratch[n++] = uint8(program[i]);
            i += 2 + uint8(program[i + 1]);
        }
        require(i == program.length, "program is not a clean instruction sequence");
        out = new uint8[](n);
        for (uint256 j; j < n; j++) out[j] = scratch[j];
    }

    function _argsOf(bytes memory program, uint8 opcode) private pure returns (bytes memory) {
        uint256 i;
        while (i < program.length) {
            uint256 len = uint8(program[i + 1]);
            if (uint8(program[i]) == opcode) {
                bytes memory a = new bytes(len);
                for (uint256 j; j < len; j++) a[j] = program[i + 2 + j];
                return a;
            }
            i += 2 + len;
        }
        revert("opcode not present in program");
    }

    // ---------------------------------------------------------------------
    // 5. Program layout — order is security-critical
    // ---------------------------------------------------------------------

    /// @dev The spec's §5 layout, byte order = nesting, outermost first. `ZentisBand` sits OUTSIDE
    ///      `ZentisSpread` on purpose: inside, it would measure the curve rate net of the spread, but
    ///      the spread stays with the maker, so that understates the maker's outcome. And
    ///      `ZentisSpread` must precede the curve or it wraps nothing — the FeeFlatIn-after-curve trap.
    function test_ProgramLayoutIsExactlyTheSpecOrder() public view {
        bytes memory program = builder.build(new bytes[](0), _args());
        uint8[] memory ops = _opcodes(program);

        assertEq(ops.length, 7, "seven instructions");
        assertEq(ops[0], Deadline.opcode.asU8(), "Deadline first");
        assertEq(ops[1], FeeProtocol.opcode.asU8(), "FeeProtocol outermost of the pricing stack");
        assertEq(ops[2], ZentisBand.opcode.asU8(), "ZentisBand outside ZentisSpread");
        assertEq(ops[3], ZentisSpread.opcode.asU8(), "ZentisSpread wraps the curve");
        assertEq(ops[4], ZentisSkew.opcode.asU8(), "ZentisSkew mutates balanceIn before pricing");
        assertEq(ops[5], XYCSwap.opcode.asU8(), "the curve prices last");
        assertEq(ops[6], Salt.opcode.asU8(), "Salt makes the strategyHash per-chain");
    }

    /// @dev Review finding #4, closed structurally. The two instructions each carry their own
    ///      `maxTiltBps` immediate deliberately — the band must be computed against the same effective
    ///      tilt that was priced — but a maker able to set them independently could typo one and
    ///      loosen the guard without changing the pricing. One struct field, two emissions.
    function test_MaxTiltBpsIsIdenticalInSkewAndBand() public view {
        bytes memory program = builder.build(new bytes[](0), _args());

        bytes memory skewArgs = _argsOf(program, ZentisSkew.opcode.asU8());
        bytes memory bandArgs = _argsOf(program, ZentisBand.opcode.asU8());

        // ZentisSkew: [ref 20 | positionId 32 | maxStaleness 4 | maxTiltBps 2 | ...] => offset 56
        // ZentisBand: [ref 20 | positionId 32 | tolBps 2 | maxTiltBps 2] => offset 54
        uint16 skewCap = (uint16(uint8(skewArgs[56])) << 8) | uint8(skewArgs[57]);
        uint16 bandCap = (uint16(uint8(bandArgs[54])) << 8) | uint8(bandArgs[55]);

        assertEq(skewCap, MAX_TILT_BPS, "skew carries the struct's cap");
        assertEq(bandCap, MAX_TILT_BPS, "band carries the same cap");
        assertEq(skewCap, bandCap, "the two immediates can never diverge");
    }

    function test_SaltBindsPositionIdAndChainSalt() public view {
        bytes memory program = builder.build(new bytes[](0), _args());
        assertEq(
            _argsOf(program, Salt.opcode.asU8()),
            abi.encodePacked(POSITION_ID, CHAIN_SALT),
            "the salt is positionId || chainSalt"
        );
    }

    /// @dev The same position on two chains must hash to two distinct strategyHashes, or Aqua sees
    ///      one order. Byte-difference is the observable part of that.
    function test_ChainSaltMakesTheProgramDistinctPerChain() public view {
        ZentisStrategies.ZentisPosition memory a = _args();
        bytes memory base = builder.build(new bytes[](0), a);
        a.chainSalt = 421614;
        bytes memory arb = builder.build(new bytes[](0), a);

        assertEq(base.length, arb.length, "same recipe, same length");
        assertTrue(keccak256(base) != keccak256(arb), "different chains must not share a program");
    }

    function test_OmitsFeeProtocolWhenFeeBpsIsZero() public view {
        ZentisStrategies.ZentisPosition memory a = _args();
        a.feeBps = 0;

        uint8[] memory ops = _opcodes(builder.build(new bytes[](0), a));
        assertEq(ops.length, 6, "no protocol fee, no FeeProtocol instruction");
        for (uint256 i; i < ops.length; i++) {
            assertTrue(ops[i] != FeeProtocol.opcode.asU8(), "FeeProtocol must be absent, not zero-fee");
        }
    }

    // ---------------------------------------------------------------------
    // the prefix bitmap — the safety model, not decoration
    // ---------------------------------------------------------------------

    function test_PrefixAcceptsValidationOnlyOpcodes() public view {
        bytes[] memory prefix = new bytes[](1);
        prefix[0] = Deadline.build(DEADLINE);

        uint8[] memory ops = _opcodes(builder.build(prefix, _args()));
        assertEq(ops.length, 8, "the prefix is prepended");
        assertEq(ops[0], Deadline.opcode.asU8());
    }

    function test_PrefixRejectsAnOpcodeThatChangesRegisters() public {
        bytes[] memory prefix = new bytes[](1);
        prefix[0] = XYCSwap.build();

        vm.expectRevert(
            abi.encodeWithSelector(ZentisStrategies.PrefixUnregistered.selector, XYCSwap.opcode.asU8())
        );
        builder.build(prefix, _args());
    }

    function test_PrefixRejectsLengthMismatch() public {
        bytes[] memory prefix = new bytes[](1);
        prefix[0] = bytes.concat(Salt.build(uint64(1)), hex"ff"); // one trailing byte too many

        vm.expectRevert(
            abi.encodeWithSelector(ZentisStrategies.PrefixInvalidLength.selector, 11, 10)
        );
        builder.build(prefix, _args());
    }

    // ---------------------------------------------------------------------
    // the built program is the hand-assembled one, and it actually runs
    // ---------------------------------------------------------------------

    function test_MatchesHandAssembledProgram() public view {
        ZentisStrategies.ZentisPosition memory a = _args();
        a.feeBps = 0;

        bytes memory expected = bytes.concat(
            Deadline.build(DEADLINE),
            ZentisBand.build(a.ref, a.positionId, a.bandTolBps, a.maxTiltBps),
            ZentisSpread.build(a.ref, a.positionId, a.floorOutA, a.floorOutB, a.spreadMaxWidenBps),
            ZentisSkew.build(
                a.ref, a.positionId, a.maxStaleness, a.maxTiltBps, a.widenBpsPerMinute, a.skewMaxWidenBps
            ),
            XYCSwap.build(),
            Salt.build(abi.encodePacked(a.positionId, a.chainSalt))
        );

        assertEq(builder.build(new bytes[](0), a), expected, "the recipe is the hand-assembled program");
    }

    /// @dev The whole point: the emitted bytes are a program the real runLoop executes, not just a
    ///      well-shaped blob. Fee-free, because FeeProtocol settles against Aqua and this harness does
    ///      not stand one up — that path is Day 4.2's on-chain fill.
    function test_BuiltProgramRunsThroughTheRealRunLoop() public {
        ZentisStrategies.ZentisPosition memory a = _args();
        a.feeBps = 0;
        a.floorOutA = 0;
        a.floorOutB = 0;

        ZentisRef memory r;
        r.mid = 1e18;
        r.spreadBps = 10;
        r.updatedAt = uint40(block.timestamp);
        r.seq = 1;
        ref.set(r);

        ZentisProgramHarness.Setup memory s;
        s.balanceIn = BALANCE_A;
        s.balanceOut = BALANCE_B;
        s.amount = AMOUNT_IN;
        s.isExactIn = true;
        s.tokenIn = TOKEN_A;
        s.tokenOut = TOKEN_B;

        (, uint256 amountOut) = runner.run(builder.build(new bytes[](0), a), s);
        assertGt(amountOut, 0, "the recipe must produce a fillable quote");
        assertLt(amountOut, BALANCE_B, "and must never drain the outbound side");
    }
}
