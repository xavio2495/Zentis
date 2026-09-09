import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  afterEach,
  assert,
  clearStore,
  describe,
  newMockEvent,
  test
} from "matchstick-as/assembly/index";
import { Docked, Pulled, Pushed, Shipped } from "../generated/Aqua/Aqua";
import { handleDocked, handlePulled, handlePushed, handleShipped } from "../src/mapping";

// The canonical router, whose opcode table is known from verified source, and an address that is
// not any known router, so its programs must decode to UNKNOWN.
const KNOWN_APP = "0x111111338c5091e8440b67b168bae16a668ac0de";
const OTHER_APP = "0x1111113db0e0ef9d0e3a50d5f094a3a57a26c0de";
const UNKNOWN_APP = "0x00000000000000000000000000000000deadbeef";

const MAKER_ONE = "0x262c9c50b08226929e0bfa36419bff3bf553fff8";
const MAKER_TWO = "0xef9f7f4006fe95afede04f6916e72556a957ebbc";

const WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

// A real strategy blob from a live position, shipped by MAKER_ONE.
const SHIPPED_BLOB =
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

let nextLog = 1;

function base(): ethereum.Event {
  const event = newMockEvent();
  event.logIndex = BigInt.fromI32(nextLog++);
  event.parameters = new Array();
  return event;
}

function shipped(maker: string, app: string, hash: string, strategy: string): Shipped {
  const event = changetype<Shipped>(base());
  event.parameters.push(
    new ethereum.EventParam("maker", ethereum.Value.fromAddress(Address.fromString(maker)))
  );
  event.parameters.push(
    new ethereum.EventParam("app", ethereum.Value.fromAddress(Address.fromString(app)))
  );
  event.parameters.push(
    new ethereum.EventParam("strategyHash", ethereum.Value.fromBytes(Bytes.fromHexString(hash)))
  );
  event.parameters.push(
    new ethereum.EventParam("strategy", ethereum.Value.fromBytes(Bytes.fromHexString(strategy)))
  );
  return event;
}

function movement<T>(maker: string, app: string, hash: string, token: string, amount: string): T {
  const event = changetype<T>(base());
  const params = (event as ethereum.Event).parameters;
  params.push(
    new ethereum.EventParam("maker", ethereum.Value.fromAddress(Address.fromString(maker)))
  );
  params.push(new ethereum.EventParam("app", ethereum.Value.fromAddress(Address.fromString(app))));
  params.push(
    new ethereum.EventParam("strategyHash", ethereum.Value.fromBytes(Bytes.fromHexString(hash)))
  );
  params.push(
    new ethereum.EventParam("token", ethereum.Value.fromAddress(Address.fromString(token)))
  );
  params.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount)))
  );
  return event;
}

function docked(maker: string, app: string, hash: string): Docked {
  const event = changetype<Docked>(base());
  event.parameters.push(
    new ethereum.EventParam("maker", ethereum.Value.fromAddress(Address.fromString(maker)))
  );
  event.parameters.push(
    new ethereum.EventParam("app", ethereum.Value.fromAddress(Address.fromString(app)))
  );
  event.parameters.push(
    new ethereum.EventParam("strategyHash", ethereum.Value.fromBytes(Bytes.fromHexString(hash)))
  );
  return event;
}

function positionId(maker: string, app: string, hash: string): string {
  return Bytes.fromUint8Array(
    Address.fromString(maker).concat(Address.fromString(app)).concat(Bytes.fromHexString(hash))
  ).toHexString();
}

function pairId(x: string, y: string): string {
  const a = x < y ? x : y;
  const b = x < y ? y : x;
  return Bytes.fromUint8Array(
    Bytes.fromHexString(a).concat(Bytes.fromHexString(b))
  ).toHexString();
}

/** Ships a two-token position and credits both tokens, which is what `ship()` emits. */
function open(maker: string, app: string, hash: string, blob: string, a: string, b: string): void {
  handleShipped(shipped(maker, app, hash, blob));
  handlePushed(movement<Pushed>(maker, app, hash, WETH, a));
  handlePushed(movement<Pushed>(maker, app, hash, USDC, b));
}

const HASH_ONE = "0x1111111111111111111111111111111111111111111111111111111111111111";
const HASH_TWO = "0x2222222222222222222222222222222222222222222222222222222222222222";

describe("a shipped position", () => {
  afterEach(() => {
    clearStore();
  });

  test("decodes, and its balances come from the events rather than a contract call", () => {
    open(MAKER_ONE, KNOWN_APP, HASH_ONE, SHIPPED_BLOB, "1000", "2000");
    const id = positionId(MAKER_ONE, KNOWN_APP, HASH_ONE);

    assert.fieldEquals("MakerPosition", id, "decoded", "true");
    assert.fieldEquals("MakerPosition", id, "dialect", "AQUA_SWAPVM_V1");
    assert.fieldEquals("MakerPosition", id, "curve", "XYC_CONCENTRATE");
    assert.fieldEquals("MakerPosition", id, "takerGated", "true");
    assert.fieldEquals(
      "PositionBalance",
      Bytes.fromUint8Array(
        Bytes.fromHexString(id).concat(Address.fromString(WETH))
      ).toHexString(),
      "amount",
      "1000"
    );
  });

  test("keeps exact balances for an app whose opcode table is unknown", () => {
    open(MAKER_ONE, UNKNOWN_APP, HASH_ONE, SHIPPED_BLOB, "1000", "2000");
    const id = positionId(MAKER_ONE, UNKNOWN_APP, HASH_ONE);

    assert.fieldEquals("MakerPosition", id, "dialect", "UNKNOWN");
    assert.fieldEquals("MakerPosition", id, "curve", "UNKNOWN");
    assert.fieldEquals(
      "PositionBalance",
      Bytes.fromUint8Array(
        Bytes.fromHexString(id).concat(Address.fromString(USDC))
      ).toHexString(),
      "amount",
      "2000"
    );
  });

  test("is retained with its raw blob when the blob is not decodable", () => {
    open(MAKER_ONE, KNOWN_APP, HASH_ONE, "0xdeadbeef", "1000", "2000");
    const id = positionId(MAKER_ONE, KNOWN_APP, HASH_ONE);

    assert.fieldEquals("MakerPosition", id, "decoded", "false");
    assert.fieldEquals("MakerPosition", id, "curve", "UNKNOWN");
    assert.fieldEquals("MakerPosition", id, "strategy", "0xdeadbeef");
  });

  test("tracks pushes and pulls exactly", () => {
    open(MAKER_ONE, KNOWN_APP, HASH_ONE, SHIPPED_BLOB, "1000", "2000");
    handlePulled(movement<Pulled>(MAKER_ONE, KNOWN_APP, HASH_ONE, WETH, "250"));
    const id = positionId(MAKER_ONE, KNOWN_APP, HASH_ONE);
    const balance = Bytes.fromUint8Array(
      Bytes.fromHexString(id).concat(Address.fromString(WETH))
    ).toHexString();

    assert.fieldEquals("PositionBalance", balance, "amount", "750");
    assert.fieldEquals("PositionBalance", balance, "pushed", "1000");
    assert.fieldEquals("PositionBalance", balance, "pulled", "250");
  });
});

describe("the venue aggregate", () => {
  afterEach(() => {
    clearStore();
  });

  // This is the test that carries the standardization claim: two different apps, one pair, one
  // aggregate. A schema that could not do this would be a router adapter, not a venue standard.
  test("sums positions from two distinct apps into one pair", () => {
    open(MAKER_ONE, KNOWN_APP, HASH_ONE, SHIPPED_BLOB, "1000", "2000");
    open(MAKER_TWO, OTHER_APP, HASH_TWO, "0xdeadbeef", "3000", "4000");

    const pair = pairId(WETH, USDC);
    assert.fieldEquals("VenuePair", pair, "activePositions", "2");
    assert.fieldEquals("VenuePair", pair, "distinctApps", "2");
    assert.fieldEquals("VenuePair", pair, "distinctMakers", "2");
    assert.fieldEquals("VenuePair", pair, "totalCommittedA", "4000");
    assert.fieldEquals("VenuePair", pair, "totalCommittedB", "6000");
  });

  test("follows a pull down", () => {
    open(MAKER_ONE, KNOWN_APP, HASH_ONE, SHIPPED_BLOB, "1000", "2000");
    handlePulled(movement<Pulled>(MAKER_ONE, KNOWN_APP, HASH_ONE, WETH, "400"));

    assert.fieldEquals("VenuePair", pairId(WETH, USDC), "totalCommittedA", "600");
  });

  // A counter that only ever grows is worse than none: the venue total would stay permanently
  // inflated by every maker who ever left.
  test("gives back everything a docked position contributed", () => {
    open(MAKER_ONE, KNOWN_APP, HASH_ONE, SHIPPED_BLOB, "1000", "2000");
    open(MAKER_TWO, OTHER_APP, HASH_TWO, "0xdeadbeef", "3000", "4000");
    handleDocked(docked(MAKER_TWO, OTHER_APP, HASH_TWO));

    const pair = pairId(WETH, USDC);
    assert.fieldEquals("VenuePair", pair, "activePositions", "1");
    assert.fieldEquals("VenuePair", pair, "distinctApps", "1");
    assert.fieldEquals("VenuePair", pair, "distinctMakers", "1");
    assert.fieldEquals("VenuePair", pair, "totalCommittedA", "1000");
    assert.fieldEquals("VenuePair", pair, "totalCommittedB", "2000");
  });
});
