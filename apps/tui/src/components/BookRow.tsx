import { type Snapshot, humanDuration, referenceAgeSeconds, weightPercent } from "@zentis/console-data";
import { duration, tokenAmount } from "../format.js";
import { type Seg, fitSegments } from "../layout.js";
import { UI } from "../theme.js";

/**
 * The overall view: one row that answers what the maker owns, whether it is still one book, and
 * whether it is making money.
 *
 * It sits above everything on every page, because a reader who looks at nothing else should still
 * know those three things. The inventory is valued at the **mainnet mark**, not at the legs' own
 * pools: an unarbitraged testnet pool can sit an order of magnitude off the market, and a book
 * marked there reports a fortune that is not in it.
 *
 * Nothing here is ever shown as a zero it did not read. A profit whose hold effect cannot be
 * separated is unknown, and says where to read why; a split with a leg unread is unknown too.
 */

/** The split an even book would have, which is what a lean is read against. */
const EVEN_PERCENT = 50;

export function bookSegments(
  snapshot: Snapshot,
  armed: boolean,
  polledAgo: number | null,
  loading: boolean,
  width: number,
): Seg[] {
  const { book } = snapshot;
  const tokenA = snapshot.legs[0]?.config.tokenA ?? null;
  const symbol = tokenA?.symbol ?? "";

  // A leg is valued when its position was read and its mark arrived; the same pair of facts the book
  // totals sum over. An inventory summed across fewer legs than the book has says so.
  const valued = snapshot.legs.filter((l) => l.position !== null && (l.mark?.mid ?? 0n) > 0n).length;
  const partial = valued < book.legs;
  const inventory: Seg[] =
    book.inventoryA === null || tokenA === null
      ? [{ text: "book unvalued", color: UI.caveat }]
      : [
          { text: "book ", color: UI.muted },
          { text: `${tokenAmount(book.inventoryA, tokenA.decimals)} ${symbol}`, color: UI.heading, bold: true },
          ...(partial ? [{ text: `, ${valued} of ${book.legs} legs`, color: UI.caveat }] : []),
        ];

  // How far the book leans, said against the even split rather than left for the reader to subtract.
  // A split over the legs that answered is not the book's split: with any leg unread it is unknown,
  // and says how many legs it could not read rather than reporting the rest as the whole.
  const unread = snapshot.legs.filter((l) => l.sources.fills !== null).length;
  const percent = book.weightA === null || unread > 0 ? null : weightPercent(book.weightA);
  const lean = percent === null ? null : Math.round((percent - EVEN_PERCENT) * 10) / 10;
  const splitLong: Seg[] =
    percent === null
      ? [
          { text: "split unknown", color: UI.caveat },
          ...(unread === 0 ? [] : [{ text: ` · ${unread} leg${unread === 1 ? "" : "s"} unread`, color: UI.muted }]),
        ]
      : [
          { text: `${percent}% ${symbol}`, color: UI.heading },
          {
            text: lean === 0 ? " · even" : ` · ${Math.abs(lean!)} ${lean! > 0 ? "over" : "under"} even`,
            color: UI.muted,
          },
        ];
  const splitShort: Seg[] =
    percent === null ? [{ text: "split unknown", color: UI.caveat }] : [{ text: `${percent}% ${symbol}`, color: UI.heading }];

  const legs: Seg[] = [
    { text: `${book.legsActive}/${book.legs}`, color: book.legsActive === book.legs ? UI.heading : UI.caveat },
    { text: " legs", color: UI.muted },
  ];

  const age = snapshot.legs
    .map((l) => referenceAgeSeconds(l, snapshot.takenAtSeconds))
    .filter((a): a is number => a !== null)
    .reduce<number | null>((max, a) => (max === null || a > max ? a : max), null);
  const seq: Seg[] =
    snapshot.seq === null
      ? [{ text: "legs on different references", color: UI.rejection }]
      : [
          { text: "seq ", color: UI.muted },
          { text: String(snapshot.seq), color: UI.heading },
          ...(age === null ? [] : [{ text: ` · ${humanDuration(age)} old`, color: UI.muted }]),
        ];

  // The profit the book has made, or why it has no total. The reason itself is a page of its own,
  // so the row names the key rather than spending the line on it.
  const profitLong: Seg[] =
    book.pnlA === null || tokenA === null
      ? // No pointer to the page: the keys row names `n`, and a line that explains where to read
        // about itself is a line spending width on the screen's own furniture.
        [
          { text: "profit ", color: UI.muted },
          { text: "unknown", color: UI.caveat },
        ]
      : [
          { text: "profit ", color: UI.muted },
          {
            // Signed by hand rather than through `signed`, which is for whole basis points: a profit
            // is an amount of a token and keeps that token's own rounding.
            text: `${book.pnlA > 0n ? "+" : ""}${tokenAmount(book.pnlA, tokenA.decimals)} ${symbol}`,
            color: book.pnlA < 0n ? UI.rejection : UI.fill,
          },
        ];
  const profitShort: Seg[] =
    book.pnlA === null || tokenA === null
      ? [
          { text: "profit ", color: UI.muted },
          { text: "unknown", color: UI.caveat },
        ]
      : profitLong;

  const mode: Seg[] = [{ text: armed ? "armed" : "watch-only", color: armed ? UI.heading : UI.muted }];
  const pulse: Seg[] = loading
    ? [{ text: "polling…", color: UI.muted }]
    : polledAgo === null
      ? []
      : [{ text: `polled ${duration(polledAgo)} ago`, color: UI.muted }];

  const dot: Seg = { text: "  ·  ", color: UI.frame };
  const join = (parts: Seg[][]): Seg[] =>
    parts.filter((p) => p.length > 0).flatMap((p, i) => (i === 0 ? p : [dot, ...p]));

  // What goes first as the row narrows, in order: the pulse, which is reassurance; the lean, which a
  // reader can take from the split; the leg count and the reference's age, which the state row below
  // still carries; then the seq. The inventory, the split, the profit and the mode are the four
  // facts the overall view exists to state, and the mode goes last of all: a console that stops
  // saying whether it can sign is one a reader may assume can.
  const seqShort: Seg[] = seq.length <= 1 ? seq : seq.slice(0, 2);
  return fitSegments(
    [
      join([inventory, splitLong, legs, seq, profitLong, mode, pulse]),
      join([inventory, splitLong, legs, seq, profitLong, mode]),
      join([inventory, splitLong, seq, profitLong, mode]),
      join([inventory, splitShort, seq, profitShort, mode]),
      join([inventory, splitShort, seqShort, profitShort, mode]),
      join([inventory, splitShort, seqShort, mode]),
      join([inventory, splitShort, mode]),
      join([inventory, mode]),
    ],
    width,
  );
}
