// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReceiverTemplate} from "cre-receiver/ReceiverTemplate.sol";
import {AggregatorV3Interface} from "chainlink-interfaces/AggregatorV3Interface.sol";
import {IZentisRef, ZentisRef} from "./IZentisRef.sol";

/// @notice Cross-chain reference registry for one Zentis position per chain. Written by the CRE
///         forwarder once the confidential workflow is live, or by the owner via `pokeRef` until then.
contract ZentisRefRegistry is IZentisRef, ReceiverTemplate {
    int256 private constant BPS = 10_000;

    error ZentisRefStaleSeq(uint32 incoming, uint32 stored);
    error ZentisRefBadTimestamp(uint40 updatedAt);
    error ZentisRefNotOwner();
    error ZentisRefCreIsLive();

    event ZentisRefUpdated(bytes32 indexed positionId, uint128 mid, int16 tiltBps, uint40 updatedAt, uint32 seq);
    event ZentisRefRejected(bytes32 indexed positionId, string reason); // loud, never silent

    mapping(bytes32 positionId => ZentisRef) private _refs;
    address public immutable OWNER;

    /// @dev address(0) disables the oracle band entirely — the documented simplification for a
    ///      leg with no standard Chainlink Data Feed for the pair (e.g. Arbitrum Sepolia ETH/USD,
    ///      which only has Data Streams, a different pull-based interface).
    AggregatorV3Interface public immutable FEED;
    uint16 public immutable FEED_BAND_BPS;

    /// @dev 1e18-fixed-point scale folding in the feed's `decimals()` and the pair's raw-token
    ///      decimals, so `mid` (raw tokenB per 1e18 raw tokenA) can be compared against the feed's
    ///      human-unit price. Computed off-chain once, at deploy time, from fixed, known decimals —
    ///      not a runtime decimals lookup, so this does not reintroduce on-chain decimals handling
    ///      into the pricing path. feedMidRaw = uint256(answer) * FEED_SCALE / 1e18.
    uint256 public immutable FEED_SCALE;

    bool public creLive;

    constructor(
        address forwarder,
        address owner_,
        address feed_,
        uint16 feedBandBps_,
        uint256 feedScale_
    ) ReceiverTemplate(forwarder) {
        OWNER = owner_;
        FEED = AggregatorV3Interface(feed_);
        FEED_BAND_BPS = feedBandBps_;
        FEED_SCALE = feedScale_;
    }

    function refOf(bytes32 id) external view returns (ZentisRef memory) {
        return _refs[id];
    }

    /// @dev Called by the CRE forwarder after DON consensus verifies the enclave attestation.
    function _processReport(bytes calldata report) internal override {
        (bytes32 id, ZentisRef memory r) = abi.decode(report, (bytes32, ZentisRef));
        _write(id, r);
    }

    /// @notice Pre-CRE path. Permanently disabled by goLive().
    function pokeRef(bytes32 id, ZentisRef calldata r) external {
        require(msg.sender == OWNER, ZentisRefNotOwner());
        require(!creLive, ZentisRefCreIsLive());
        _write(id, r);
    }

    function goLive() external {
        require(msg.sender == OWNER, ZentisRefNotOwner());
        creLive = true;
    }

    function _write(bytes32 id, ZentisRef memory r) private {
        ZentisRef memory prev = _refs[id];
        require(r.seq > prev.seq, ZentisRefStaleSeq(r.seq, prev.seq));
        require(r.updatedAt <= block.timestamp && r.updatedAt >= prev.updatedAt, ZentisRefBadTimestamp(r.updatedAt));

        // Oracle-band rejection intentionally does NOT revert: IReceiver's own contract is that a
        // revert means "transient failure, retry" (see IReceiver.onReport), and a revert here would
        // both discard the ZentisRefRejected event (logs roll back with the rest of the tx) and have
        // the DON retry the same, deliberately-rejected report forever. Instead, skip the write and
        // leave the previous ref in place — it ages and the spread widens, exactly as intended when
        // the reference is not trustworthy, and the rejection is still visible on-chain via the event.
        if (!_withinOracleBand(r.mid)) {
            emit ZentisRefRejected(id, "mid outside oracle band");
            return;
        }

        _refs[id] = r;
        emit ZentisRefUpdated(id, r.mid, r.tiltBps, r.updatedAt, r.seq);
    }

    /// @dev §2.3: not oracle-priced AMM — the curve still prices against real Aqua reserves and the
    ///      feed never touches pricing. This is a bound on the reference, answering "what if the
    ///      enclave is compromised or wrong." Wide by construction (FEED_BAND_BPS) so it catches
    ///      only gross failure, not legitimate fast moves.
    function _withinOracleBand(uint128 mid) private view returns (bool) {
        if (address(FEED) == address(0)) return true;

        (, int256 answer,,,) = FEED.latestRoundData();
        if (answer <= 0) return false;

        uint256 feedMid = (uint256(answer) * FEED_SCALE) / 1e18;
        uint256 diff = mid > feedMid ? mid - feedMid : feedMid - mid;
        uint256 bandBps = (diff * uint256(BPS)) / feedMid;
        return bandBps <= FEED_BAND_BPS;
    }
}
