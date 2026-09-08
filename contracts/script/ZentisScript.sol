// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";

import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {MakerTraitsLib} from "swap-vm/libs/MakerTraits.sol";

import {ZentisStrategies} from "../src/strategies/ZentisStrategies.sol";
import {ZentisPositionConfig} from "./ZentisPositionConfig.sol";

/// @notice Shared base for the scripts that touch a live position. Ship and fill both reconstruct
///         the SAME order here: the program bytes are the strategy, and the strategyHash Aqua
///         records is the hash of this order, so a single byte of drift between the two scripts
///         would leave the fill quoting against a strategy that was never shipped.
/// @notice `buildZentisPosition` takes `bytes[] calldata` to match the pinned `Strategies.sol`, so
///         it can only be reached through an external call — and a script may not call itself
///         (forge rejects `address(this)` in scripts, since a script address is ephemeral). This
///         contract is instantiated OUTSIDE `startBroadcast`, so it exists only in the simulation
///         and never becomes an on-chain artifact; only the program bytes it returns survive, as
///         calldata to `ship()`.
contract ZentisProgramBuilder {
    function build(bytes[] calldata prefix, ZentisStrategies.ZentisPosition calldata args)
        external
        pure
        returns (bytes memory)
    {
        return ZentisStrategies.buildZentisPosition(prefix, args);
    }
}

abstract contract ZentisScript is Script {
    function _order(address maker, address ref, address tokenA, address tokenB)
        internal
        returns (ISwapVM.Order memory)
    {
        bytes[] memory prefix = new bytes[](0);
        bytes memory program =
            new ZentisProgramBuilder().build(prefix, ZentisPositionConfig.fromEnv(vm, ref));

        MakerTraitsLib.Args memory args;
        args.maker = maker;
        args.tokenA = tokenA;
        args.tokenB = tokenB;
        args.useAquaInsteadOfSignature = true;
        args.program = program;
        return MakerTraitsLib.build(args);
    }
}
