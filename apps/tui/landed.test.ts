import { expect, test } from "bun:test";
import { landed } from "./src/landed.js";

const pending = { label: "republish fast", seqBefore: 1789033455 };

test("a seq newer than the one before the action is the write landing", () => {
  expect(landed(pending, 1789034230)).toBe("seq 1789034230 landed — republish fast");
});

test("the same seq is not a landing, however long it has been", () => {
  expect(landed(pending, 1789033455)).toBeNull();
});

test("an older seq is not a landing either, which a leg falling behind can produce", () => {
  expect(landed(pending, 1789033000)).toBeNull();
});

test("legs on different seqs say nothing: there is no one number to have moved", () => {
  // `seq` is null when the legs have drifted apart. Announcing a landing off one leg's number would
  // claim the book republished when only part of it did.
  expect(landed(pending, null)).toBeNull();
});

test("nothing is claimed when no action is waiting on a write", () => {
  expect(landed(null, 1789034230)).toBeNull();
});

test("an action taken while the legs were split still recognises the first shared seq", () => {
  // With no seq to compare against, the first one the poll agrees on is the write landing: the
  // alternative is a console that can never confirm a republish that healed a split book.
  expect(landed({ label: "republish slow", seqBefore: null }, 1789034230)).toBe(
    "seq 1789034230 landed — republish slow"
  );
});
