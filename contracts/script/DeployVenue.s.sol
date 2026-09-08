// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";

import {AquaRouter} from "@1inch/aqua/src/AquaRouter.sol";

import {ZentisRouter} from "../src/routers/ZentisRouter.sol";

/// @notice Deploys the venue for one chain: an Aqua settlement router from the pinned `aqua`
///         submodule, and the Zentis SwapVM router (the Aqua "app") over it. Both are deployed
///         from unmodified upstream sources except for ZentisRouter's 7-entry opcode table — there
///         is no canonical Aqua deployment on either testnet (V5), so self-deployment is the only
///         path.
contract DeployVenue is Script {
    function run() external returns (AquaRouter aqua, ZentisRouter router) {
        uint256 deployerKey = vm.envUint("WALLET_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address weth = vm.envAddress("WETH");

        vm.startBroadcast(deployerKey);
        aqua = new AquaRouter(deployer);
        router = new ZentisRouter(address(aqua), weth, deployer);
        vm.stopBroadcast();

        console2.log("chain id       ", block.chainid);
        console2.log("AquaRouter     ", address(aqua));
        console2.log("ZentisRouter   ", address(router));
        console2.log("WETH           ", weth);
    }
}
