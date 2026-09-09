import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Docked, Pulled, Pushed, Shipped } from "../generated/Aqua/Aqua";
import { App, Instruction, MakerPosition, Movement, PositionBalance } from "../generated/schema";
import { CURVE_UNKNOWN, classify } from "./classify";
import { DIALECT_UNKNOWN, dialectOf, opcodeInfo } from "./dialect";
import { decodeOrder, walkProgram } from "./program";
import { applyDelta, joinPair, leavePair } from "./venue";

function positionId(maker: Address, app: Address, strategyHash: Bytes): Bytes {
  return Bytes.fromUint8Array(maker.concat(app).concat(strategyHash));
}

function loadApp(address: Address): App {
  let app = App.load(address);
  if (app == null) {
    app = new App(address);
    app.dialect = dialectOf(address);
    app.positionCount = 0;
    app.decodedPositionCount = 0;
  }
  return app;
}

export function handleShipped(event: Shipped): void {
  const app = loadApp(event.params.app);
  const id = positionId(event.params.maker, event.params.app, event.params.strategyHash);

  const position = new MakerPosition(id);
  position.strategyHash = event.params.strategyHash;
  position.maker = event.params.maker;
  position.app = app.id;
  position.active = true;
  position.tokens = [];
  position.strategy = event.params.strategy;
  position.dialect = app.dialect;
  position.curve = CURVE_UNKNOWN;
  position.takerGated = false;
  position.hasInvalidator = false;
  position.customOpcodes = [];
  position.instructionCount = 0;
  position.decoded = false;
  position.inAggregate = false;
  position.shippedAtBlock = event.block.number;
  position.shippedAtTimestamp = event.block.timestamp;
  position.fillCount = 0;

  const order = decodeOrder(event.params.strategy, event.params.maker);
  if (order != null) {
    const instructions = walkProgram(order.program);
    if (instructions != null) {
      position.decoded = true;
      position.instructionCount = instructions.length;

      for (let i = 0; i < instructions.length; i++) {
        const instr = instructions[i];
        const info = opcodeInfo(app.dialect, instr.opcode);
        const entity = new Instruction(id.concatI32(i));
        entity.position = id;
        entity.index = i;
        entity.opcode = instr.opcode;
        entity.name = info.name;
        entity.known = info.known;
        entity.args = instr.args;
        entity.save();
      }

      const summary = classify(app.dialect, instructions);
      position.curve = summary.curve;
      position.feeBps = summary.feeBps;
      position.protocolFeeBps = summary.protocolFeeBps;
      position.protocolFeeReceiver = summary.protocolFeeReceiver;
      position.takerGated = summary.takerGated;
      position.takerGateToken = summary.takerGateToken;
      position.hasInvalidator = summary.hasInvalidator;
      position.customOpcodes = summary.customOpcodes;

      app.decodedPositionCount = app.decodedPositionCount + 1;
    }
  }

  position.save();
  app.positionCount = app.positionCount + 1;
  app.save();
}

export function handleDocked(event: Docked): void {
  const id = positionId(event.params.maker, event.params.app, event.params.strategyHash);
  const position = MakerPosition.load(id);
  if (position == null) return;

  // Leave the aggregate BEFORE zeroing the balances, so what is subtracted is what was actually
  // committed. Doing it after would remove zero and leave the venue total permanently inflated.
  leavePair(position, event);

  position.active = false;
  position.dockedAtBlock = event.block.number;
  position.save();

  // Docking zeroes every one of the strategy's balances in the registry.
  const tokens = position.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const balance = PositionBalance.load(id.concat(tokens[i]));
    if (balance == null) continue;
    balance.amount = BigInt.zero();
    balance.save();
  }
}

function recordMovement(
  event: ethereum.Event,
  position: MakerPosition,
  kind: string,
  token: Address,
  amount: BigInt
): void {
  const movement = new Movement(
    Bytes.fromUint8Array(event.transaction.hash.concatI32(event.logIndex.toI32()))
  );
  movement.position = position.id;
  movement.kind = kind;
  movement.token = token;
  movement.amount = amount;
  movement.transaction = event.transaction.hash;
  movement.logIndex = event.logIndex;
  movement.blockNumber = event.block.number;
  movement.timestamp = event.block.timestamp;
  movement.save();
}

function loadBalance(position: MakerPosition, token: Address): PositionBalance {
  const balanceId = position.id.concat(token);
  let balance = PositionBalance.load(balanceId);
  if (balance == null) {
    balance = new PositionBalance(balanceId);
    balance.position = position.id;
    balance.token = token;
    balance.amount = BigInt.zero();
    balance.pushed = BigInt.zero();
    balance.pulled = BigInt.zero();

    const tokens = position.tokens;
    tokens.push(token);
    position.tokens = tokens;
  }
  return balance;
}

/**
 * Keeps the venue aggregate in step with one position's balance change.
 *
 * A position joins the aggregate the moment its second token appears, which is when the pair is
 * first known — `ship()` emits one push per token, so that is mid-transaction. A position that
 * grows a third token is no longer a pair and leaves again rather than being folded in under a
 * guess about which two tokens matter.
 */
function updateVenue(
  position: MakerPosition,
  token: Address,
  delta: BigInt,
  event: ethereum.Event
): void {
  const count = position.tokens.length;
  if (position.inAggregate) {
    if (count != 2) leavePair(position, event);
    else applyDelta(position, token, delta, event);
    return;
  }
  if (count == 2) joinPair(position, event);
}

export function handlePushed(event: Pushed): void {
  const id = positionId(event.params.maker, event.params.app, event.params.strategyHash);
  const position = MakerPosition.load(id);
  if (position == null) return;

  const balance = loadBalance(position, event.params.token);
  balance.amount = balance.amount.plus(event.params.amount);
  balance.pushed = balance.pushed.plus(event.params.amount);
  balance.save();

  updateVenue(position, event.params.token, event.params.amount, event);
  position.save();

  recordMovement(event, position, "PUSH", event.params.token, event.params.amount);
}

export function handlePulled(event: Pulled): void {
  const id = positionId(event.params.maker, event.params.app, event.params.strategyHash);
  const position = MakerPosition.load(id);
  if (position == null) return;

  const balance = loadBalance(position, event.params.token);
  balance.amount = balance.amount.minus(event.params.amount);
  balance.pulled = balance.pulled.plus(event.params.amount);
  balance.save();

  updateVenue(position, event.params.token, event.params.amount.neg(), event);

  // A taker fill pays the maker in one token and takes the other; the pull is the leg the
  // maker gives up, so counting pulls counts fills once each.
  position.fillCount = position.fillCount + 1;
  position.save();

  recordMovement(event, position, "PULL", event.params.token, event.params.amount);
}
