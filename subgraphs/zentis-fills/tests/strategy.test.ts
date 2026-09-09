import { Address, Bytes } from "@graphprotocol/graph-ts";
import { assert, describe, test } from "matchstick-as/assembly/index";
import { decodeStrategy, readSkewArgs } from "../src/strategy";

// The strategy blob of the live Base Sepolia leg, taken from the ship transaction that
// created it. Its keccak256 is the strategy hash recorded in the deployment file, so these
// are the exact bytes the router runs.
const SHIPPED =
  "0x" +
    "0000000000000000000000000000000000000000000000000000000000000020" +
    "0000000000000000000000004887b4695dee830a341304bfeb14538e2442dd55" +
    "4000000000280028002800280000000000000000000000000000000000000000" +
    "0000000000000000000000000000000000000000000000000000000000000060" +
    "000000000000000000000000000000000000000000000000000000000000012d" +
    "036cbd53842c5426634e7929541ec2318f3dcf7e420000000000000000000000" +
    "00000000000000062005006ac81ee0b3382fe4cce316287505ce114101b9d58c" +
    "1f56d8e910000000000000000000000000000000000000000000000000000000" +
    "000000000101f401f49f562fe4cce316287505ce114101b9d58c1f56d8e91000" +
    "0000000000000000000000000000000000000000000000000000000000000100" +
    "0000000000000000000000001e8480000000000000000000038d7ea4c6800000" +
    "c89e3e2fe4cce316287505ce114101b9d58c1f56d8e910000000000000000000" +
    "000000000000000000000000000000000000000000000100000e1001f4000a00" +
    "c850000228000000000000000000000000000000000000000000000000000000" +
    "00000000010000000000014a3400000000000000000000000000000000000000";
const MAKER = "0x4887b4695dee830a341304bfeb14538e2442dd55";
const POSITION_ID = "0x0000000000000000000000000000000000000000000000000000000000000001";
const REF_REGISTRY = "0x2fe4cce316287505ce114101b9d58c1f56d8e910";
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const WETH = "0x4200000000000000000000000000000000000006";

describe("strategy decoding", () => {
  test("the live leg yields its tokens and its program", () => {
    const program = decodeStrategy(Bytes.fromHexString(SHIPPED), Address.fromString(MAKER));
    assert.assertNotNull(program);
    assert.bytesEquals(Bytes.fromHexString(USDC), program!.tokenA);
    assert.bytesEquals(Bytes.fromHexString(WETH), program!.tokenB);
  });

  test("a blob shipped by someone else is not read as this maker's leg", () => {
    assert.assertNull(
      decodeStrategy(
        Bytes.fromHexString(SHIPPED),
        Address.fromString("0x00000000000000000000000000000000deadbeef")
      )
    );
  });
});

describe("the skew instruction carries the cross-chain identity", () => {
  test("positionId, registry and the bounds the maker signed are read back", () => {
    const program = decodeStrategy(Bytes.fromHexString(SHIPPED), Address.fromString(MAKER));
    const skew = readSkewArgs(program!.code);
    assert.assertNotNull(skew);
    assert.bytesEquals(Bytes.fromHexString(POSITION_ID), skew!.positionId);
    assert.bytesEquals(Bytes.fromHexString(REF_REGISTRY), skew!.refRegistry);
    assert.i32Equals(3600, skew!.maxStalenessSeconds);
    assert.i32Equals(500, skew!.maxTiltBps);
    assert.i32Equals(10, skew!.widenBpsPerMinute);
    assert.i32Equals(200, skew!.maxWidenBps);
  });

  test("a program with no skew instruction is not a Zentis leg", () => {
    // Deadline then the plain constant-product swap: a valid program, but not one of ours.
    assert.assertNull(readSkewArgs(Bytes.fromHexString("0x2005006ac81ee05000")));
  });

  test("a program claiming more argument bytes than it has is rejected", () => {
    assert.assertNull(readSkewArgs(Bytes.fromHexString("0x50009e3e")));
  });
});
