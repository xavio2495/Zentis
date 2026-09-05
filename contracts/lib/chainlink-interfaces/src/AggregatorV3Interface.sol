// SPDX-License-Identifier: MIT
// Vendored from smartcontractkit/chainlink-evm,
// contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol
// commit 811fe603ae67ec13b7f6ca1fb034840d33ad5303, unmodified.
pragma solidity ^0.8.0;

// solhint-disable-next-line interface-starts-with-i
interface AggregatorV3Interface {
  function decimals() external view returns (uint8);

  function description() external view returns (string memory);

  function version() external view returns (uint256);

  function getRoundData(
    uint80 _roundId
  ) external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

  function latestRoundData()
    external
    view
    returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
