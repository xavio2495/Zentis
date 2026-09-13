import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

/**
 * What the pnl page says hold covers, now that most of the inventory arrived by push.
 *
 * It used to say hold covered what each leg was shipped with and name the rest as unvalued. That
 * was honest while a push was a top-up: half a milli-WETH against a shipped five. It stopped being
 * honest when the legs were grown — two thirds of each leg's tokenB arrived by push — because a
 * line reading "hold covers what each leg was shipped with" over a total that looks like the book's
 * is a total speaking for a third of the book.
 *
 * Hold now values every parcel from the day it entered. The page says so, and still names whatever
 * entered with no recorded price, because that part is still a gap.
 */
const said = (lines: string[]) => lines.join(" ").replace(/[│┌┐└┘╰╯─]/g, " ").replace(/\s+/g, " ");

test("the page says hold is valued parcel by parcel, not shipped-side only", async () => {
  const text = said((await drive(120, 40, { keys: ["n"] })).lines);
  expect(text).toMatch(/each parcel|parcel by parcel|entered at/i);
  // The old sentence claimed less than hold now does, and must not survive it.
  expect(text).not.toMatch(/hold covers what each leg was shipped with/i);
}, 60_000);

test("inventory that entered with no recorded price is still named", async () => {
  const text = said((await drive(120, 40, { keys: ["n"] })).lines);
  // The sandbox's legs hold tokenB that no tranche speaks for, which is the state a leg pushed to
  // before the transaction log existed is in.
  expect(text).toMatch(/no recorded price|not in it|without a price/i);
  expect(text).toMatch(/WETH/);
}, 60_000);
