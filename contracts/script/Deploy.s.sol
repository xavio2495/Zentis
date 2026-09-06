// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {ZentisRefRegistry} from "../src/ref/ZentisRefRegistry.sol";

/// @notice Deploys ZentisRefRegistry to one chain. Pre-CRE: the forwarder address is a placeholder
///         (the deployer's own address) since no real CRE Forwarder address exists yet — the DON
///         grant is still pending (cg1/TASK_ORDER.md 1.1/1.2). Update it via setForwarderAddress()
///         once known; the pre-CRE pokeRef() path this script relies on is unaffected either way.
///         FEED_SCALE is likewise a placeholder (identity, 1e18) until a real token pair with known
///         decimals is chosen — see docs/DECISIONS.md.
contract Deploy is Script {
    uint16 internal constant FEED_BAND_BPS = 500;
    uint256 internal constant FEED_SCALE_PLACEHOLDER = 1e18;

    function run() external returns (ZentisRefRegistry registry) {
        uint256 deployerKey = vm.envUint("WALLET_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address feed = vm.envOr("ORACLE_FEED", address(0));

        vm.startBroadcast(deployerKey);
        registry = new ZentisRefRegistry(deployer, deployer, feed, FEED_BAND_BPS, FEED_SCALE_PLACEHOLDER);
        vm.stopBroadcast();

        console2.log("ZentisRefRegistry deployed at", address(registry));
        console2.log("owner / placeholder forwarder", deployer);
        console2.log("oracle feed (0 = disabled)", feed);
    }
}
