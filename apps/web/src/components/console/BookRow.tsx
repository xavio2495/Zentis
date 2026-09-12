"use client";

import { ago, signedBps, tokenAmount } from "@/lib/format";
import { inventorySplit } from "@/lib/leg-cards";
import type { BookTotals, Provider } from "@/lib/replay";
import { Stat, VRule } from "./ui";

/**
 * The book above the legs: one position, totalled.
 *
 * The age is the reference's age *at the recorded moment* and is never recomputed against the
 * reader's clock — a recording played back tomorrow would otherwise age into a staleness alarm and
 * accuse a healthy book of being stale.
 */
export function BookRow({ book, providers }: { book: BookTotals | undefined; providers: Provider[] }) {
  if (book === undefined) {
    return (
      <div className="flex h-9 shrink-0 items-center border-b border-stroke bg-inset px-4">
        <span className="label-sm text-ink-faint">book unread</span>
      </div>
    );
  }
  const split = inventorySplit(book.weightA);
  const usdc = (raw: string | null) => (raw === null ? "—" : `${tokenAmount(raw, 6)} USDC`);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-stroke bg-inset px-4 py-1.5">
      {/* Which moment this band is. The bar above follows the playhead and is hundreds of rounds
          behind this; saying so is the difference between two readings and one contradiction. */}
      <span className="label-sm whitespace-nowrap border border-line2 px-1.5 py-0.5 text-ink-faint">
        recorded moment · seq {book.seq === null ? "—" : book.seq}
      </span>
      <Stat label="inventory" value={usdc(book.inventoryA)} tone={book.inventoryA === null ? "faint" : "ink"} />
      <VRule />
      <Stat
        label="USDC share"
        value={split === null ? "—" : `${(split.shareA * 100).toFixed(1)}%`}
        sub={split === null ? undefined : "even split is 50%"}
        tone="soft"
      />
      <VRule />
      <Stat label="reference age" value={`${ago(0, book.ageSeconds)} old at the read`} tone="faint" />
      <VRule />
      <Stat label="PnL, this generation" value={usdc(book.pnlA)} tone={book.pnlA === null ? "faint" : "ink"} />
      <VRule />
      <Stat label="trading" value={usdc(book.tradingA)} tone="soft" />
      <VRule />
      <Stat label="hold" value={usdc(book.holdA)} tone="soft" />
      <VRule />
      <Stat label="legs" value={`${book.legsActive}/${book.legs}`} tone={book.legsActive === book.legs ? "signal" : "warn"} />
      <div className="flex-1" />
      <div className="flex flex-wrap items-center gap-1.5">
        {providers.map((provider) => (
          <span
            key={`${provider.kind}-${provider.name}`}
            title={provider.reason ?? provider.detail ?? provider.name}
            className="flex items-center gap-1 text-[10px] text-ink-faint"
          >
            <span
              aria-hidden
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                provider.state === "up" ? "bg-ink-dim" : provider.state === "stale" ? "bg-warn" : "bg-bad"
              }`}
            />
            {provider.name}
          </span>
        ))}
      </div>
      {book.caveat === null ? null : <p className="m-0 basis-full text-[10px] text-warn">{book.caveat}</p>}
    </div>
  );
}
