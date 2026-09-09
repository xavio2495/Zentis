import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { MakerPosition, PositionBalance, VenuePair, VenuePairApp, VenuePairMaker } from "../generated/schema";

/**
 * Venue-level aggregation: how every maker on the venue is positioned in one pair.
 *
 * A position joins the aggregate once both of its tokens are known and leaves when it docks or
 * turns out not to be a two-token position. Membership is tracked explicitly rather than counted,
 * because a distinct-maker counter that only ever increments drifts permanently wrong the first
 * time somebody docks.
 */

/** Addresses are fixed-width, so lexicographic hex order is numeric order. */
function sorted(x: Bytes, y: Bytes): Bytes[] {
  return x.toHexString() < y.toHexString() ? [x, y] : [y, x];
}

function loadPair(tokenA: Bytes, tokenB: Bytes, event: ethereum.Event): VenuePair {
  const id = Bytes.fromUint8Array(tokenA.concat(tokenB));
  let pair = VenuePair.load(id);
  if (pair == null) {
    pair = new VenuePair(id);
    pair.tokenA = tokenA;
    pair.tokenB = tokenB;
    pair.totalCommittedA = BigInt.zero();
    pair.totalCommittedB = BigInt.zero();
    pair.activePositions = 0;
    pair.distinctMakers = 0;
    pair.distinctApps = 0;
  }
  const p = pair as VenuePair;
  p.lastUpdatedBlock = event.block.number;
  p.lastUpdatedTimestamp = event.block.timestamp;
  return p;
}

function balanceOf(position: MakerPosition, token: Bytes): BigInt {
  const balance = PositionBalance.load(position.id.concat(token));
  return balance == null ? BigInt.zero() : balance.amount;
}

/** Returns the number of members after the change, so the caller can tell 0->1 and 1->0 apart. */
function bumpMaker(pair: VenuePair, maker: Bytes, delta: i32): i32 {
  const id = Bytes.fromUint8Array(pair.id.concat(maker));
  let link = VenuePairMaker.load(id);
  if (link == null) {
    link = new VenuePairMaker(id);
    link.pair = pair.id;
    link.maker = maker;
    link.activePositions = 0;
  }
  const l = link as VenuePairMaker;
  l.activePositions = l.activePositions + delta;
  l.save();
  return l.activePositions;
}

function bumpApp(pair: VenuePair, app: Bytes, delta: i32): i32 {
  const id = Bytes.fromUint8Array(pair.id.concat(app));
  let link = VenuePairApp.load(id);
  if (link == null) {
    link = new VenuePairApp(id);
    link.pair = pair.id;
    link.app = app;
    link.activePositions = 0;
  }
  const l = link as VenuePairApp;
  l.activePositions = l.activePositions + delta;
  l.save();
  return l.activePositions;
}

/** Adds a two-token position's current balances to its pair. */
export function joinPair(position: MakerPosition, event: ethereum.Event): void {
  const tokens = position.tokens;
  if (tokens.length != 2) return;

  const ordered = sorted(tokens[0], tokens[1]);
  const pair = loadPair(ordered[0], ordered[1], event);

  pair.totalCommittedA = pair.totalCommittedA.plus(balanceOf(position, ordered[0]));
  pair.totalCommittedB = pair.totalCommittedB.plus(balanceOf(position, ordered[1]));
  pair.activePositions = pair.activePositions + 1;
  if (bumpMaker(pair, position.maker, 1) == 1) pair.distinctMakers = pair.distinctMakers + 1;
  if (bumpApp(pair, position.app, 1) == 1) pair.distinctApps = pair.distinctApps + 1;
  pair.save();

  position.pair = pair.id;
  position.inAggregate = true;
}

/** Removes a position's remaining balances from its pair. Docking must do this, or the total drifts. */
export function leavePair(position: MakerPosition, event: ethereum.Event): void {
  const pairId = position.pair;
  if (pairId === null) return;
  const loaded = VenuePair.load(pairId!);
  if (loaded == null) return;
  const pair = loaded as VenuePair;

  pair.totalCommittedA = pair.totalCommittedA.minus(balanceOf(position, pair.tokenA));
  pair.totalCommittedB = pair.totalCommittedB.minus(balanceOf(position, pair.tokenB));
  pair.activePositions = pair.activePositions - 1;
  if (bumpMaker(pair, position.maker, -1) == 0) pair.distinctMakers = pair.distinctMakers - 1;
  if (bumpApp(pair, position.app, -1) == 0) pair.distinctApps = pair.distinctApps - 1;
  pair.lastUpdatedBlock = event.block.number;
  pair.lastUpdatedTimestamp = event.block.timestamp;
  pair.save();

  position.inAggregate = false;
}

/** Moves one token's committed total by a signed amount, for a position already in the aggregate. */
export function applyDelta(
  position: MakerPosition,
  token: Bytes,
  delta: BigInt,
  event: ethereum.Event
): void {
  const pairId = position.pair;
  if (pairId === null) return;
  const loaded = VenuePair.load(pairId!);
  if (loaded == null) return;
  const pair = loaded as VenuePair;

  if (pair.tokenA.equals(token)) pair.totalCommittedA = pair.totalCommittedA.plus(delta);
  else if (pair.tokenB.equals(token)) pair.totalCommittedB = pair.totalCommittedB.plus(delta);
  else return;

  pair.lastUpdatedBlock = event.block.number;
  pair.lastUpdatedTimestamp = event.block.timestamp;
  pair.save();
}
