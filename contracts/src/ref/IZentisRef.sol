// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Cross-chain reference for one Zentis position. Two slots.
struct ZentisRef {
    // ---- slot 0 ----
    uint128 mid; // raw tokenB per 1e18 raw tokenA
    uint16 spreadBps; // base half-spread from the workflow
    int16 tiltBps; // tilt at reference time, signed vs tokenA
    uint40 updatedAt; // timestamp of the QUERIED block, not the write
    uint32 seq; // monotonic; replay + reordering protection
    // ---- slot 1 ----
    uint128 refBalanceA; // maker's local tokenA balance when tiltBps was computed
    int64 dTiltPerA; // d(tiltBps)/d(balanceA), 1e18-scaled, signed
    uint32 maxExtrapBps; // cap on |tilt - tiltRef|
    uint16 markoutBps; // adverse-selection widen term
    uint16 bandEdgeBps; // b, the impulse boundary, published as maxTiltBps
}

interface IZentisRef {
    function refOf(bytes32 positionId) external view returns (ZentisRef memory);
}
