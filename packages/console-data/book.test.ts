import { expect, test } from "bun:test";
import { bookTotals } from "./src/book.js";

/**
 * A book with nothing in it has earned nothing *that anyone read*, which is not the same as zero.
 *
 * Every total here is a sum over the legs that could be read, and summing over none of them gave
 * 0n — the empty sum — which the screen printed as "profit 0 USDC" during an outage. That is the
 * failure this module exists to refuse, arriving through a door it had left open.
 */
test("a book with no readable legs has no totals, rather than the empty sum", () => {
  const book = bookTotals([]);
  expect(book.pnlA).toBeNull();
  expect(book.tradingA).toBeNull();
  expect(book.holdA).toBeNull();
  expect(book.inventoryA).toBeNull();
  expect(book.weightA).toBeNull();
  expect(book.caveat).not.toBeNull();
});

test("a book whose legs all failed to read is the same as one with none", () => {
  const unread = [
    { position: null, mark: null, pnl: null, sources: { fills: "subgraph HTTP 429" } },
    { position: null, mark: null, pnl: null, sources: { fills: "subgraph HTTP 429" } },
  ] as never[];
  const book = bookTotals(unread);
  expect(book.pnlA).toBeNull();
  expect(book.inventoryA).toBeNull();
});
