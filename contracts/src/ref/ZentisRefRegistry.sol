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
    error ZentisRefZeroMid();

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
        _write(id, r, false);
    }

    /// @notice Pre-CRE path. Permanently disabled by goLive().
    function pokeRef(bytes32 id, ZentisRef calldata r) external {
        require(msg.sender == OWNER, ZentisRefNotOwner());
        require(!creLive, ZentisRefCreIsLive());
        _write(id, r, true);
    }

    function goLive() external {
        require(msg.sender == OWNER, ZentisRefNotOwner());
        creLive = true;
    }

    /// @param loud whether a rejected reference should revert (the owner's interactive `pokeRef`) or
    ///        be skipped with an event (the forwarder's `onReport`).
    ///
    /// @dev Rejection on the report path intentionally does NOT revert. `IReceiver.onReport`'s own
    ///      contract is that a revert means "transient failure, retry" — but none of these conditions
    ///      can clear on a retry: a replayed seq stays replayed, a report that predates the stored one
    ///      stays older, a zero mid stays malformed, and a reference outside the oracle band was
    ///      deliberately refused. Reverting would ask the DON to retry one doomed report forever, and
    ///      would roll back the very event that makes the rejection visible, since logs are discarded
    ///      with the rest of the transaction. Instead the write is skipped and the previous reference
    ///      is left in place — it ages, the spread widens, and the position degrades rather than
    ///      going dark, which is what should happen when the reference is not trustworthy.
    ///
    ///      `pokeRef` passes `loud = true`: it is an interactive owner call, where the caller wants
    ///      the offending values back and there is no retry loop to poison.
    function _write(bytes32 id, ZentisRef memory r, bool loud) private {
        ZentisRef memory prev = _refs[id];

        // A zero mid is never a legitimate reference, and with the oracle band disabled nothing else
        // would catch it. ZentisBand derives its bound by scaling mid, so a stored zero collapses the
        // bound to zero: one direction would then admit every fill and the other reject every fill.
        if (r.mid == 0) {
            require(!loud, ZentisRefZeroMid());
            emit ZentisRefRejected(id, "zero mid");
            return;
        }
        if (r.seq <= prev.seq) {
            require(!loud, ZentisRefStaleSeq(r.seq, prev.seq));
            emit ZentisRefRejected(id, "stale seq");
            return;
        }
        if (r.updatedAt > block.timestamp || r.updatedAt < prev.updatedAt) {
            require(!loud, ZentisRefBadTimestamp(r.updatedAt));
            emit ZentisRefRejected(id, "bad timestamp");
            return;
        }
        // The band is never loud on either path: it is a policy refusal of a well-formed reference,
        // not a caller error, and the owner poking one past the band wants the same event a DON does.
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
        // Truncation can zero this out even for a positive answer, and dividing by it below would
        // panic — which _write's whole no-revert design exists to avoid, since a panic propagating
        // out of _processReport is what makes the DON retry one bad report forever.
        if (feedMid == 0) return false;

        uint256 diff = mid > feedMid ? mid - feedMid : feedMid - mid;
        uint256 bandBps = (diff * uint256(BPS)) / feedMid;
        return bandBps <= FEED_BAND_BPS;
    }
}
