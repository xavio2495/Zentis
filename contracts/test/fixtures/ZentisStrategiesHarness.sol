// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ZentisStrategies} from "../../src/strategies/ZentisStrategies.sol";

/// @notice `buildZentisPosition` takes `bytes[] calldata`, matching the pinned `Strategies.sol`, so a
///         test has to reach it through an external call to get real calldata.
contract ZentisStrategiesHarness {
    function build(bytes[] calldata prefix, ZentisStrategies.ZentisPosition calldata args)
        external
        pure
        returns (bytes memory)
    {
        return ZentisStrategies.buildZentisPosition(prefix, args);
    }
}
