import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Instruction } from "./program";
import {
  DIALECT_AQUA_SWAPVM_V1,
  OP_AQUA_PROTOCOL_FEE_IN,
  OP_DECAY,
  OP_EXTRUCTION,
  OP_FLAT_FEE_IN,
  OP_ONLY_TX_ORIGIN_BALANCE_NON_ZERO,
  OP_PEGGED_SWAP,
  OP_PROTOCOL_FEE_IN,
  OP_XYC_CONCENTRATE,
  OP_XYC_SWAP,
  opcodeInfo
} from "./dialect";

// CurveKind ids, mirrored from schema.graphql.
export const CURVE_XYC = "XYC";
export const CURVE_XYC_CONCENTRATE = "XYC_CONCENTRATE";
export const CURVE_XYC_DECAY = "XYC_DECAY";
export const CURVE_PEGGED = "PEGGED";
export const CURVE_EXTRUCTION = "EXTRUCTION";
export const CURVE_NONE = "NONE";
export const CURVE_UNKNOWN = "UNKNOWN";

export class Classification {
  curve: string;
  /** Whether the program carries a maker fee at all, as distinct from a zero one. */
  hasFee: boolean;
  hasProtocolFee: boolean;
  feeBps: BigInt | null;
  protocolFeeBps: BigInt | null;
  protocolFeeReceiver: Bytes | null;
  takerGated: boolean;
  takerGateToken: Bytes | null;
  hasInvalidator: boolean;
  customOpcodes: i32[];

  constructor() {
    this.curve = CURVE_UNKNOWN;
    this.hasFee = false;
    this.hasProtocolFee = false;
    this.feeBps = null;
    this.protocolFeeBps = null;
    this.protocolFeeReceiver = null;
    this.takerGated = false;
    this.takerGateToken = null;
    this.hasInvalidator = false;
    this.customOpcodes = [];
  }
}

function beToBigInt(args: Bytes, start: i32, length: i32): BigInt | null {
  if (args.length < start + length) return null;
  const le = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    le[i] = args[start + length - 1 - i];
  }
  return BigInt.fromUnsignedBytes(Bytes.fromUint8Array(le));
}

function addressAt(args: Bytes, start: i32): Bytes | null {
  if (args.length < start + 20) return null;
  return Bytes.fromUint8Array(args.subarray(start, start + 20));
}

/**
 * Reduces a decoded program to the standardized fields. Nothing here infers a value from an
 * opcode the dialect does not define: an unrecognised opcode is recorded in customOpcodes
 * and otherwise ignored, and a program on an unknown dialect classifies as UNKNOWN with
 * every one of its opcodes reported as custom.
 */
export function classify(dialect: string, instructions: Instruction[]): Classification {
  const out = new Classification();

  let sawXyc = false;
  let sawConcentrate = false;
  let sawDecay = false;
  let sawPegged = false;
  let sawExtruction = false;

  for (let i = 0; i < instructions.length; i++) {
    const instr = instructions[i];
    const opcode = instr.opcode;
    const info = opcodeInfo(dialect, opcode);
    if (!info.known) {
      if (!out.customOpcodes.includes(opcode)) out.customOpcodes.push(opcode);
      continue;
    }
    if (dialect != DIALECT_AQUA_SWAPVM_V1) continue;

    if (opcode == OP_XYC_SWAP) sawXyc = true;
    else if (opcode == OP_XYC_CONCENTRATE) sawConcentrate = true;
    else if (opcode == OP_DECAY) sawDecay = true;
    else if (opcode == OP_PEGGED_SWAP) sawPegged = true;
    else if (opcode == OP_EXTRUCTION) sawExtruction = true;
    else if (opcode == OP_FLAT_FEE_IN) {
      out.feeBps = beToBigInt(instr.args, 0, 4);
      out.hasFee = true;
    } else if (opcode == OP_PROTOCOL_FEE_IN || opcode == OP_AQUA_PROTOCOL_FEE_IN) {
      out.protocolFeeBps = beToBigInt(instr.args, 0, 4);
      out.protocolFeeReceiver = addressAt(instr.args, 4);
      out.hasProtocolFee = true;
    } else if (opcode == OP_ONLY_TX_ORIGIN_BALANCE_NON_ZERO) {
      out.takerGated = true;
      out.takerGateToken = addressAt(instr.args, 0);
    }
  }

  if (dialect != DIALECT_AQUA_SWAPVM_V1) return out;

  // The deployed table registers no order-invalidator instruction, so for this dialect a
  // false here is a positive statement rather than a missing observation.
  out.hasInvalidator = false;

  // A concentrated or decaying program still runs the constant-product step, so the
  // modifier is what names the curve. Extruction prices externally and overrides all.
  if (sawExtruction) out.curve = CURVE_EXTRUCTION;
  else if (sawPegged) out.curve = CURVE_PEGGED;
  else if (sawConcentrate) out.curve = CURVE_XYC_CONCENTRATE;
  else if (sawDecay) out.curve = CURVE_XYC_DECAY;
  else if (sawXyc) out.curve = CURVE_XYC;
  else out.curve = CURVE_NONE;

  return out;
}
