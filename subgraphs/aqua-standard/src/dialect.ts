import { Address, Bytes } from "@graphprotocol/graph-ts";

// Dialect ids, mirrored from schema.graphql's Dialect enum.
export const DIALECT_AQUA_SWAPVM_V1 = "AQUA_SWAPVM_V1";
export const DIALECT_UNKNOWN = "UNKNOWN";

// Apps whose opcode table is known from verified source. Every entry below is a 1inch
// SwapVM router built from the v1.0.1 or v1.0.2 tag; those two builds differ only inside
// the fee instruction, not in the dispatch table, so they share one dialect.
//
// Routers deliberately left out: 0xdfd05fe230bfe7b212878414270c72c8345506fa (an earlier
// build with no taker-gate instruction) and 0x8fdd04dbf6111437b44bbca99c28882434e0958f
// (a 28-entry table). Their tables are not verified here, so positions on them decode as
// UNKNOWN rather than being read against a table they may not use.
const KNOWN_APPS: string[] = [
  "0x111111338c5091e8440b67b168bae16a668ac0de",
  "0x1111113db0e0ef9d0e3a50d5f094a3a57a26c0de",
  "0x016b417bc933370f5eacc40b1d58b015ac72b070",
  "0x3c4758979ec30ca45857cabc2462a70699ed790e",
  "0xa5368dd669c5706256cf417b66e71a1efe1d331a"
];

export function dialectOf(app: Address): string {
  const needle = app.toHexString();
  for (let i = 0; i < KNOWN_APPS.length; i++) {
    if (KNOWN_APPS[i] == needle) return DIALECT_AQUA_SWAPVM_V1;
  }
  return DIALECT_UNKNOWN;
}

// Dispatch indices for the AQUA_SWAPVM_V1 table.
//
// The router builds a 35-entry static array and then overwrites entry 0 with the array
// length to turn it into a 34-entry dynamic array, so every instruction dispatches one slot
// below where it is written in the source. These are the post-shift indices, i.e. the
// numbers that actually appear in program bytecode.
export const OP_JUMP: i32 = 10;
export const OP_JUMP_IF_TOKEN_IN: i32 = 11;
export const OP_JUMP_IF_TOKEN_OUT: i32 = 12;
export const OP_DEADLINE: i32 = 13;
export const OP_ONLY_TAKER_BALANCE_NON_ZERO: i32 = 14;
export const OP_ONLY_TAKER_BALANCE_GTE: i32 = 15;
export const OP_ONLY_TAKER_SUPPLY_SHARE_GTE: i32 = 16;
export const OP_XYC_SWAP: i32 = 17;
export const OP_XYC_CONCENTRATE: i32 = 18;
export const OP_DECAY: i32 = 19;
export const OP_SALT: i32 = 20;
export const OP_FLAT_FEE_IN: i32 = 21;
export const OP_PROTOCOL_FEE_IN: i32 = 27;
export const OP_AQUA_PROTOCOL_FEE_IN: i32 = 28;
export const OP_DYNAMIC_PROTOCOL_FEE_IN: i32 = 29;
export const OP_AQUA_DYNAMIC_PROTOCOL_FEE_IN: i32 = 30;
export const OP_PEGGED_SWAP: i32 = 31;
export const OP_EXTRUCTION: i32 = 32;
export const OP_ONLY_TX_ORIGIN_BALANCE_NON_ZERO: i32 = 33;

// Slots the router maps to its no-op sentinel: 0-9 are held for debug utilities and 22-26
// for backward compatibility. They are part of the table, so they are not custom opcodes,
// but they are not instructions either.
export const NAME_RESERVED = "reserved";
export const NAME_UNKNOWN = "UNKNOWN";

export class OpcodeInfo {
  name: string;
  known: bool;

  constructor(name: string, known: bool) {
    this.name = name;
    this.known = known;
  }
}

export function opcodeInfo(dialect: string, opcode: i32): OpcodeInfo {
  if (dialect != DIALECT_AQUA_SWAPVM_V1) return new OpcodeInfo(NAME_UNKNOWN, false);

  if (opcode <= 9) return new OpcodeInfo(NAME_RESERVED, true);
  if (opcode >= 22 && opcode <= 26) return new OpcodeInfo(NAME_RESERVED, true);

  if (opcode == OP_JUMP) return new OpcodeInfo("jump", true);
  if (opcode == OP_JUMP_IF_TOKEN_IN) return new OpcodeInfo("jumpIfTokenIn", true);
  if (opcode == OP_JUMP_IF_TOKEN_OUT) return new OpcodeInfo("jumpIfTokenOut", true);
  if (opcode == OP_DEADLINE) return new OpcodeInfo("deadline", true);
  if (opcode == OP_ONLY_TAKER_BALANCE_NON_ZERO) return new OpcodeInfo("onlyTakerTokenBalanceNonZero", true);
  if (opcode == OP_ONLY_TAKER_BALANCE_GTE) return new OpcodeInfo("onlyTakerTokenBalanceGte", true);
  if (opcode == OP_ONLY_TAKER_SUPPLY_SHARE_GTE) return new OpcodeInfo("onlyTakerTokenSupplyShareGte", true);
  if (opcode == OP_XYC_SWAP) return new OpcodeInfo("xycSwap", true);
  if (opcode == OP_XYC_CONCENTRATE) return new OpcodeInfo("xycConcentrateGrowLiquidity", true);
  if (opcode == OP_DECAY) return new OpcodeInfo("decay", true);
  if (opcode == OP_SALT) return new OpcodeInfo("salt", true);
  if (opcode == OP_FLAT_FEE_IN) return new OpcodeInfo("flatFeeAmountIn", true);
  if (opcode == OP_PROTOCOL_FEE_IN) return new OpcodeInfo("protocolFeeAmountIn", true);
  if (opcode == OP_AQUA_PROTOCOL_FEE_IN) return new OpcodeInfo("aquaProtocolFeeAmountIn", true);
  if (opcode == OP_DYNAMIC_PROTOCOL_FEE_IN) return new OpcodeInfo("dynamicProtocolFeeAmountIn", true);
  if (opcode == OP_AQUA_DYNAMIC_PROTOCOL_FEE_IN) return new OpcodeInfo("aquaDynamicProtocolFeeAmountIn", true);
  if (opcode == OP_PEGGED_SWAP) return new OpcodeInfo("peggedSwapGrowPriceRange", true);
  if (opcode == OP_EXTRUCTION) return new OpcodeInfo("extruction", true);
  if (opcode == OP_ONLY_TX_ORIGIN_BALANCE_NON_ZERO) return new OpcodeInfo("onlyTxOriginTokenBalanceNonZero", true);

  return new OpcodeInfo(NAME_UNKNOWN, false);
}

export function emptyBytes(): Bytes {
  return Bytes.fromUint8Array(new Uint8Array(0));
}
