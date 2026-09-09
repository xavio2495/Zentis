import { Address, Bytes } from "@graphprotocol/graph-ts";

// The strategy blob a maker ships to a SwapVM router is abi.encode(Order), where Order is
// { address maker; uint256 traits; bytes data }. Because the struct has a dynamic member it
// encodes as a tuple: a head offset, the two static words, an offset to `data`, then data's
// length and body.
//
//   [  0.. 32)  0x20            offset to the tuple
//   [ 32.. 64)  maker           left-padded address
//   [ 64.. 96)  traits          packed flags and slice indexes
//   [ 96..128)  0x60            offset to `data` within the tuple
//   [128..160)  dataLength
//   [160..   )  data, right-padded to a multiple of 32
//
// Anything that does not match that shape is some other app's own encoding and is left
// undecoded rather than guessed at.
const ENVELOPE_HEAD: i32 = 160;

// traits bit positions, counted from the least significant bit.
const BIT_USE_AQUA: i32 = 254;
const BIT_SHOULD_UNWRAP: i32 = 255;

// `data` is cut into four hook slices and then the program. The four end offsets live in
// traits bits 160..223, sixteen bits each, lowest bits holding the first slice's end. The
// program therefore starts at the fourth offset.
const SLICE_INDEXES_BIT_OFFSET: i32 = 160;

export class Order {
  maker: Address;
  program: Bytes;

  constructor(maker: Address, program: Bytes) {
    this.maker = maker;
    this.program = program;
  }
}

// Reads a big-endian 32-byte word's bit, where bit 0 is the least significant.
function wordBit(strategy: Bytes, wordStart: i32, bit: i32): boolean {
  const byteFromTop = 31 - (bit >> 3);
  return (strategy[wordStart + byteFromTop] & (1 << (bit & 7))) != 0;
}

// Reads sixteen bits out of a big-endian 32-byte word starting at the given bit position.
// The position must be byte-aligned, which every slice index is.
function wordU16(strategy: Bytes, wordStart: i32, bit: i32): i32 {
  const lowByteFromTop = 31 - (bit >> 3);
  return (i32(strategy[wordStart + lowByteFromTop - 1]) << 8) | i32(strategy[wordStart + lowByteFromTop]);
}

// True when the word at wordStart holds nothing but a right-aligned 20-byte address.
function isAddressWord(strategy: Bytes, wordStart: i32): boolean {
  for (let i = 0; i < 12; i++) {
    if (strategy[wordStart + i] != 0) return false;
  }
  return true;
}

function wordEquals(strategy: Bytes, wordStart: i32, value: i32): boolean {
  for (let i = 0; i < 31; i++) {
    if (strategy[wordStart + i] != 0) return false;
  }
  return strategy[wordStart + 31] == value;
}

/**
 * Recovers the instruction program from a strategy blob, or returns null when the blob is
 * not a SwapVM order. `expectedMaker` is the address Aqua recorded as the shipper: a real
 * order carries the same maker inside it, and checking that rules out blobs that merely
 * happen to start with the right constants.
 */
export function decodeOrder(strategy: Bytes, expectedMaker: Address): Order | null {
  if (strategy.length < ENVELOPE_HEAD) return null;
  if (!wordEquals(strategy, 0, 0x20)) return null;
  if (!wordEquals(strategy, 96, 0x60)) return null;
  if (!isAddressWord(strategy, 32)) return null;

  const maker = Address.fromBytes(Bytes.fromUint8Array(strategy.subarray(44, 64)));
  if (!maker.equals(expectedMaker)) return null;

  // A data length that needs more than four bytes is not a length, it is a coincidence.
  for (let i = 128; i < 156; i++) {
    if (strategy[i] != 0) return null;
  }
  const dataLength: i32 =
    (i32(strategy[156]) << 24) |
    (i32(strategy[157]) << 16) |
    (i32(strategy[158]) << 8) |
    i32(strategy[159]);
  if (dataLength < 0) return null;

  const padded = (dataLength + 31) & ~31;
  if (strategy.length != ENVELOPE_HEAD + padded) return null;

  const programStart = wordU16(strategy, 64, SLICE_INDEXES_BIT_OFFSET + 48);
  if (programStart > dataLength) return null;

  const program = Bytes.fromUint8Array(
    strategy.subarray(ENVELOPE_HEAD + programStart, ENVELOPE_HEAD + dataLength)
  );
  return new Order(maker, program);
}

export function usesAquaBalances(strategy: Bytes): boolean {
  return wordBit(strategy, 64, BIT_USE_AQUA);
}

export function unwrapsWeth(strategy: Bytes): boolean {
  return wordBit(strategy, 64, BIT_SHOULD_UNWRAP);
}

export class Instruction {
  opcode: i32;
  args: Bytes;

  constructor(opcode: i32, args: Bytes) {
    this.opcode = opcode;
    this.args = args;
  }
}

/**
 * Walks a program as a sequence of [1 byte opcode][1 byte argsLength][args]. Returns null
 * if any instruction claims more argument bytes than the program has left, which is the
 * same condition the VM reverts on.
 */
export function walkProgram(program: Bytes): Instruction[] | null {
  const out: Instruction[] = [];
  let pc = 0;
  while (pc < program.length) {
    if (pc + 2 > program.length) return null;
    const opcode = program[pc];
    const argsLength = program[pc + 1];
    const argsStart = pc + 2;
    const next = argsStart + argsLength;
    if (next > program.length) return null;
    out.push(new Instruction(opcode, Bytes.fromUint8Array(program.subarray(argsStart, next))));
    pc = next;
  }
  return out;
}
