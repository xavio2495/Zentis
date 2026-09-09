import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { assert, describe, test } from "matchstick-as/assembly/index";
import { CURVE_UNKNOWN, CURVE_XYC, CURVE_XYC_CONCENTRATE, classify } from "../src/classify";
import { DIALECT_AQUA_SWAPVM_V1, DIALECT_UNKNOWN, dialectOf } from "../src/dialect";
import { decodeOrder, walkProgram } from "../src/program";

// Both blobs below are taken verbatim from positions open on the canonical Aqua router on
// Arbitrum One, so the decoder is pinned against bytes the protocol actually produced
// rather than against bytes this repository invented.

// Concentrated position: taker-gated, with both a maker fee and a protocol fee.
const CONCENTRATED =
  "0x" +
    "0000000000000000000000000000000000000000000000000000000000000020" +
    "000000000000000000000000262c9c50b08226929e0bfa36419bff3bf553fff8" +
    "4000000000000000000000000000000000000000000000000000000000000000" +
    "0000000000000000000000000000000000000000000000000000000000000060" +
    "0000000000000000000000000000000000000000000000000000000000000084" +
    "211426ffc7d378e8e49be2c483295a3e3e511f96a4681c180003d0908063d4fa" +
    "f54bf8c898dc6ddc689c76ab12b4614a12400000000000000000000000000000" +
    "000000000000000000000ddf46578f3287e20000000000000000000000000000" +
    "000000000000000000000de2d3ec633ae49d1504000f4240110014085680d3c8" +
    "cab3fe1600000000000000000000000000000000000000000000000000000000";
const CONCENTRATED_MAKER = "0x262c9c50b08226929e0bfa36419bff3bf553fff8";

// Plain constant-product position: fee, swap, salt, and nothing else.
const PLAIN_XYC =
  "0x" +
    "0000000000000000000000000000000000000000000000000000000000000020" +
    "000000000000000000000000ef9f7f4006fe95afede04f6916e72556a957ebbc" +
    "4c00000000000000000000000000000000000000000000000000000000000000" +
    "0000000000000000000000000000000000000000000000000000000000000060" +
    "0000000000000000000000000000000000000000000000000000000000000012" +
    "15040007a12011001408078ff48f91b88a670000000000000000000000000000";
const PLAIN_XYC_MAKER = "0xef9f7f4006fe95afede04f6916e72556a957ebbc";

const KYC_NFT = "0x26ffc7d378e8e49be2c483295a3e3e511f96a468";
const CANONICAL_ROUTER = "0x111111338c5091e8440b67b168bae16a668ac0de";

describe("dialect assignment", () => {
  test("the canonical router gets the verified opcode table", () => {
    assert.stringEquals(DIALECT_AQUA_SWAPVM_V1, dialectOf(Address.fromString(CANONICAL_ROUTER)));
  });

  test("an unrecognised app claims no table", () => {
    assert.stringEquals(
      DIALECT_UNKNOWN,
      dialectOf(Address.fromString("0x00000000000000000000000000000000deadbeef"))
    );
  });
});

describe("order envelope", () => {
  test("a blob whose inner maker is not the shipper is not decoded", () => {
    assert.assertNull(
      decodeOrder(Bytes.fromHexString(PLAIN_XYC), Address.fromString(CONCENTRATED_MAKER))
    );
  });

  test("bytes that are not an order envelope are not decoded", () => {
    assert.assertNull(
      decodeOrder(Bytes.fromHexString("0xdeadbeef"), Address.fromString(PLAIN_XYC_MAKER))
    );
  });
});

describe("program walk", () => {
  test("a plain constant-product program decodes to fee, swap, salt", () => {
    const order = decodeOrder(Bytes.fromHexString(PLAIN_XYC), Address.fromString(PLAIN_XYC_MAKER));
    assert.assertNotNull(order);
    const list = walkProgram(order!.program)!;
    assert.i32Equals(3, list.length);
    assert.i32Equals(21, list[0].opcode);
    assert.i32Equals(17, list[1].opcode);
    assert.i32Equals(20, list[2].opcode);

    const summary = classify(DIALECT_AQUA_SWAPVM_V1, list);
    assert.stringEquals(CURVE_XYC, summary.curve);
    assert.bigIntEquals(BigInt.fromI32(500000), summary.feeBps!);
    assert.assertTrue(!summary.takerGated);
    assert.assertTrue(!summary.hasProtocolFee);
    assert.i32Equals(0, summary.customOpcodes.length);
  });

  test("a concentrated program reports its modifier, both fees and its taker gate", () => {
    const order = decodeOrder(
      Bytes.fromHexString(CONCENTRATED),
      Address.fromString(CONCENTRATED_MAKER)
    );
    assert.assertNotNull(order);
    const list = walkProgram(order!.program)!;
    assert.i32Equals(6, list.length);

    const summary = classify(DIALECT_AQUA_SWAPVM_V1, list);
    assert.stringEquals(CURVE_XYC_CONCENTRATE, summary.curve);
    assert.bigIntEquals(BigInt.fromI32(1000000), summary.feeBps!);
    assert.bigIntEquals(BigInt.fromI32(250000), summary.protocolFeeBps!);
    assert.assertTrue(summary.takerGated);
    assert.bytesEquals(Bytes.fromHexString(KYC_NFT), summary.takerGateToken!);
    assert.assertTrue(!summary.hasInvalidator);
    assert.i32Equals(0, summary.customOpcodes.length);
  });

  test("a program claiming more argument bytes than it has is rejected", () => {
    // Opcode 17, then opcode 21 announcing four argument bytes with only one present.
    assert.assertNull(walkProgram(Bytes.fromHexString("0x11001504ff")));
  });
});

describe("honesty on unknown apps", () => {
  test("every opcode of an unattributed program is reported as custom, not guessed", () => {
    const order = decodeOrder(Bytes.fromHexString(PLAIN_XYC), Address.fromString(PLAIN_XYC_MAKER));
    const list = walkProgram(order!.program)!;

    const summary = classify(DIALECT_UNKNOWN, list);
    assert.stringEquals(CURVE_UNKNOWN, summary.curve);
    assert.i32Equals(3, summary.customOpcodes.length);
    assert.assertTrue(!summary.hasFee);
    assert.assertTrue(!summary.takerGated);
  });
});
