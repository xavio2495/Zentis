import { Address, Bytes } from "@graphprotocol/graph-ts";

// The Zentis router is a SwapVM router built from the pinned engine, so a shipped strategy is
// abi.encode(Order) with Order { address maker; uint256 traits; bytes data }:
//
//   [  0.. 32)  0x20
//   [ 32.. 64)  maker
//   [ 64.. 96)  traits
//   [ 96..128)  0x60
//   [128..160)  dataLength
//   [160..   )  data, right-padded to a multiple of 32
//
// and `data` is tokenA || tokenB || four hook slices || program. The program's start offset
// is the fourth of four sixteen-bit slice ends packed into traits bits 160..223, so it is
// read from traits rather than assumed to be 40.
const ENVELOPE_HEAD: i32 = 160;
const SLICE_INDEXES_BIT_OFFSET: i32 = 160;
const TOKENS_LENGTH: i32 = 40;

// Zentis instructions occupy free slots in the engine's opcode banks.
export const OP_ZENTIS_SKEW: i32 = 0x9e;
export const OP_ZENTIS_SPREAD: i32 = 0x9f;
export const OP_ZENTIS_BAND: i32 = 0xb3;

export class Program {
  tokenA: Bytes;
  tokenB: Bytes;
  code: Bytes;

  constructor(tokenA: Bytes, tokenB: Bytes, code: Bytes) {
    this.tokenA = tokenA;
    this.tokenB = tokenB;
    this.code = code;
  }
}

function wordEquals(strategy: Bytes, wordStart: i32, value: i32): boolean {
  for (let i = 0; i < 31; i++) {
    if (strategy[wordStart + i] != 0) return false;
  }
  return strategy[wordStart + 31] == value;
}

function wordU16(strategy: Bytes, wordStart: i32, bit: i32): i32 {
  const lowByteFromTop = 31 - (bit >> 3);
  return (
    (i32(strategy[wordStart + lowByteFromTop - 1]) << 8) | i32(strategy[wordStart + lowByteFromTop])
  );
}

/** Returns the leg's tokens and program, or null if the blob is not an order this router runs. */
export function decodeStrategy(strategy: Bytes, expectedMaker: Address): Program | null {
  if (strategy.length < ENVELOPE_HEAD) return null;
  if (!wordEquals(strategy, 0, 0x20)) return null;
  if (!wordEquals(strategy, 96, 0x60)) return null;
  for (let i = 32; i < 44; i++) {
    if (strategy[i] != 0) return null;
  }
  const maker = Address.fromBytes(Bytes.fromUint8Array(strategy.subarray(44, 64)));
  if (!maker.equals(expectedMaker)) return null;

  for (let i = 128; i < 156; i++) {
    if (strategy[i] != 0) return null;
  }
  const dataLength: i32 =
    (i32(strategy[156]) << 24) |
    (i32(strategy[157]) << 16) |
    (i32(strategy[158]) << 8) |
    i32(strategy[159]);
  const padded = (dataLength + 31) & ~31;
  if (strategy.length != ENVELOPE_HEAD + padded) return null;
  if (dataLength < TOKENS_LENGTH) return null;

  const programStart = wordU16(strategy, 64, SLICE_INDEXES_BIT_OFFSET + 48);
  if (programStart < TOKENS_LENGTH || programStart > dataLength) return null;

  return new Program(
    Bytes.fromUint8Array(strategy.subarray(ENVELOPE_HEAD, ENVELOPE_HEAD + 20)),
    Bytes.fromUint8Array(strategy.subarray(ENVELOPE_HEAD + 20, ENVELOPE_HEAD + TOKENS_LENGTH)),
    Bytes.fromUint8Array(
      strategy.subarray(ENVELOPE_HEAD + programStart, ENVELOPE_HEAD + dataLength)
    )
  );
}

// ZentisSkew's arguments, in the order the instruction reads them back.
//
//   [ 0..20)  reference registry
//   [20..52)  positionId
//   [52..56)  maxStaleness, seconds
//   [56..58)  maxTiltBps
//   [58..60)  widenBpsPerMinute
//   [60..62)  maxWidenBps
const SKEW_ARGS_LENGTH: i32 = 62;

export class SkewArgs {
  refRegistry: Bytes;
  positionId: Bytes;
  maxStalenessSeconds: i32;
  maxTiltBps: i32;
  widenBpsPerMinute: i32;
  maxWidenBps: i32;

  constructor(
    refRegistry: Bytes,
    positionId: Bytes,
    maxStalenessSeconds: i32,
    maxTiltBps: i32,
    widenBpsPerMinute: i32,
    maxWidenBps: i32
  ) {
    this.refRegistry = refRegistry;
    this.positionId = positionId;
    this.maxStalenessSeconds = maxStalenessSeconds;
    this.maxTiltBps = maxTiltBps;
    this.widenBpsPerMinute = widenBpsPerMinute;
    this.maxWidenBps = maxWidenBps;
  }
}

function beI32(args: Bytes, start: i32, length: i32): i32 {
  let out = 0;
  for (let i = 0; i < length; i++) {
    out = (out << 8) | i32(args[start + i]);
  }
  return out;
}

/**
 * Walks the program as [opcode][argsLength][args] and returns the skew instruction's
 * arguments. A leg without one is not a Zentis position, and a program whose walk runs off
 * the end of its bytes is not decoded at all.
 */
export function readSkewArgs(code: Bytes): SkewArgs | null {
  let pc = 0;
  while (pc < code.length) {
    if (pc + 2 > code.length) return null;
    const opcode = i32(code[pc]);
    const argsLength = i32(code[pc + 1]);
    const argsStart = pc + 2;
    const next = argsStart + argsLength;
    if (next > code.length) return null;

    if (opcode == OP_ZENTIS_SKEW && argsLength >= SKEW_ARGS_LENGTH) {
      const args = Bytes.fromUint8Array(code.subarray(argsStart, next));
      return new SkewArgs(
        Bytes.fromUint8Array(args.subarray(0, 20)),
        Bytes.fromUint8Array(args.subarray(20, 52)),
        beI32(args, 52, 4),
        beI32(args, 56, 2),
        beI32(args, 58, 2),
        beI32(args, 60, 2)
      );
    }
    pc = next;
  }
  return null;
}
