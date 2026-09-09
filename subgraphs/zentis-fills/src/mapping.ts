import { Address, BigInt, Bytes, dataSource, ethereum } from "@graphprotocol/graph-ts";
import { Docked, Pulled, Pushed, Shipped } from "../generated/Aqua/Aqua";
import { Swapped } from "../generated/ZentisRouter/ZentisRouter";
import {
  ZentisRefRejected,
  ZentisRefUpdated
} from "../generated/ZentisRefRegistry/ZentisRefRegistry";
import {
  Fill,
  LatestReference,
  Position,
  RejectedReference,
  Reference,
  StrategyLink
} from "../generated/schema";
import { decodeStrategy, readSkewArgs } from "./strategy";

function chainId(): i32 {
  const network = dataSource.network();
  if (network == "base-sepolia") return 84532;
  if (network == "arbitrum-sepolia") return 421614;
  if (network == "sepolia") return 11155111;
  // Deliberately not a silent default. A leg reporting chain 0 is a manifest deployed to a network
  // this mapping has never been told about, and it should be obvious in the data.
  return 0;
}

function eventId(event: ethereum.Event): Bytes {
  return Bytes.fromUint8Array(event.transaction.hash.concatI32(event.logIndex.toI32()));
}

function positionOf(strategyHash: Bytes): Position | null {
  const link = StrategyLink.load(strategyHash);
  if (link == null) return null;
  return Position.load(link.position);
}

export function handleShipped(event: Shipped): void {
  const program = decodeStrategy(event.params.strategy, event.params.maker);
  if (program == null) return;

  const skew = readSkewArgs(program.code);
  if (skew == null) return;

  let position = Position.load(skew.positionId);
  if (position == null) {
    position = new Position(skew.positionId);
    position.fillCount = 0;
    position.hasReference = false;
    position.volumeInA = BigInt.zero();
    position.volumeInB = BigInt.zero();
  }
  // A re-ship replaces the leg: new strategy hash, new balances, same position.
  position.chainId = chainId();
  position.strategyHash = event.params.strategyHash;
  position.maker = event.params.maker;
  position.app = event.params.app;
  position.strategy = event.params.strategy;
  position.tokenA = program.tokenA;
  position.tokenB = program.tokenB;
  position.active = true;
  position.refRegistry = skew.refRegistry;
  position.maxTiltBps = skew.maxTiltBps;
  position.maxStalenessSeconds = skew.maxStalenessSeconds;
  position.widenBpsPerMinute = skew.widenBpsPerMinute;
  position.maxWidenBps = skew.maxWidenBps;
  position.balanceA = BigInt.zero();
  position.balanceB = BigInt.zero();
  position.dockedAtBlock = null;
  position.shippedAtBlock = event.block.number;
  position.shippedAtTimestamp = event.block.timestamp;

  // A leg cannot be shipped until a reference exists, because the ship sizes the position against
  // it. So the first reference always predates the position, and without this the leg would start
  // life claiming none had been published — and price its first fills as unreferenced.
  const latest = LatestReference.load(skew.positionId);
  if (latest != null) {
    const leg = position as Position;
    leg.hasReference = true;
    leg.refMid = latest.mid;
    leg.refTiltBps = latest.tiltBps;
    leg.refSeq = latest.seq;
    leg.refUpdatedAt = latest.updatedAt;
  }
  position.save();

  const link = new StrategyLink(event.params.strategyHash);
  link.position = position.id;
  link.save();
}

export function handleDocked(event: Docked): void {
  const position = positionOf(event.params.strategyHash);
  if (position == null) return;
  // Only the leg that is currently shipped can be docked out from under itself.
  if (!position.strategyHash.equals(event.params.strategyHash)) return;

  position.active = false;
  position.dockedAtBlock = event.block.number;
  position.balanceA = BigInt.zero();
  position.balanceB = BigInt.zero();
  position.save();
}

function applyBalance(position: Position, token: Address, delta: BigInt): void {
  if (position.tokenA.equals(token)) position.balanceA = position.balanceA.plus(delta);
  else if (position.tokenB.equals(token)) position.balanceB = position.balanceB.plus(delta);
}

export function handlePushed(event: Pushed): void {
  const position = positionOf(event.params.strategyHash);
  if (position == null) return;
  if (!position.strategyHash.equals(event.params.strategyHash)) return;
  applyBalance(position, event.params.token, event.params.amount);
  position.save();
}

export function handlePulled(event: Pulled): void {
  const position = positionOf(event.params.strategyHash);
  if (position == null) return;
  if (!position.strategyHash.equals(event.params.strategyHash)) return;
  applyBalance(position, event.params.token, event.params.amount.neg());
  position.save();
}

export function handleSwapped(event: Swapped): void {
  const position = positionOf(event.params.orderHash);
  if (position == null) return;

  const fill = new Fill(eventId(event));
  fill.position = position.id;
  fill.chainId = position.chainId;
  fill.orderHash = event.params.orderHash;
  fill.taker = event.params.taker;
  fill.tokenIn = event.params.tokenIn;
  fill.tokenOut = event.params.tokenOut;
  fill.amountIn = event.params.amountIn;
  fill.amountOut = event.params.amountOut;

  const isAToB = position.tokenA.equals(event.params.tokenIn);
  fill.isAToB = isAToB;

  // The reference the curve actually priced against, captured now: reading it back later
  // would give whatever the workflow has published since.
  fill.hasReference = position.hasReference;
  fill.refMid = position.refMid;
  fill.refTiltBps = position.refTiltBps;
  fill.refSeq = position.refSeq;
  fill.refUpdatedAt = position.refUpdatedAt;
  const refUpdatedAt = position.refUpdatedAt;
  fill.refAgeSeconds = refUpdatedAt === null ? null : event.block.timestamp.minus(refUpdatedAt!);

  fill.transaction = event.transaction.hash;
  fill.logIndex = event.logIndex;
  fill.blockNumber = event.block.number;
  fill.timestamp = event.block.timestamp;
  fill.save();

  if (isAToB) position.volumeInA = position.volumeInA.plus(event.params.amountIn);
  else position.volumeInB = position.volumeInB.plus(event.params.amountIn);
  position.fillCount = position.fillCount + 1;
  position.save();
}

export function handleRefUpdated(event: ZentisRefUpdated): void {
  const position = Position.load(event.params.positionId);

  const seq = event.params.seq.toI32();
  const reference = new Reference(
    Bytes.fromUint8Array(event.params.positionId.concatI32(seq))
  );
  reference.positionId = event.params.positionId;
  if (position != null) {
    reference.position = position.id;
    reference.chainId = position.chainId;
  }
  reference.mid = event.params.mid;
  reference.tiltBps = event.params.tiltBps;
  reference.seq = seq;
  reference.updatedAt = event.params.updatedAt;
  reference.transaction = event.transaction.hash;
  reference.blockNumber = event.block.number;
  reference.timestamp = event.block.timestamp;
  reference.save();

  // Recorded whether or not a leg exists yet, so a later ship can pick it up. A new leg cannot be
  // shipped before a reference exists, because the ship sizes the position against it, so the
  // first reference on every leg necessarily arrives before the position does.
  let latest = LatestReference.load(event.params.positionId);
  if (latest == null) latest = new LatestReference(event.params.positionId);
  const record = latest as LatestReference;
  record.mid = event.params.mid;
  record.tiltBps = event.params.tiltBps;
  record.seq = seq;
  record.updatedAt = event.params.updatedAt;
  record.save();

  if (position == null) return;
  const leg = position as Position;
  leg.hasReference = true;
  leg.refMid = event.params.mid;
  leg.refTiltBps = event.params.tiltBps;
  leg.refSeq = seq;
  leg.refUpdatedAt = event.params.updatedAt;
  leg.save();
}

export function handleRefRejected(event: ZentisRefRejected): void {
  const position = Position.load(event.params.positionId);

  const rejection = new RejectedReference(eventId(event));
  rejection.positionId = event.params.positionId;
  if (position != null) {
    rejection.position = position.id;
    rejection.chainId = position.chainId;
  }
  rejection.reason = event.params.reason;
  rejection.transaction = event.transaction.hash;
  rejection.blockNumber = event.block.number;
  rejection.timestamp = event.block.timestamp;
  rejection.save();
}
