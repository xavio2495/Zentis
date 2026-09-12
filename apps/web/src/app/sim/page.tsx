"use client";

import { useEffect } from "react";
import { Screen } from "@/components/console/Screen";
import { ReplayProvider } from "@/lib/store";

/**
 * The replay surface: a fixed instrument screen over recorded testnet reads.
 *
 * Client-rendered because it is a running clock rather than a document. The data behind it is
 * static JSON served through `/api/replay` and `/api/sim`, so nothing here can fail live — the
 * demo does not depend on an indexer answering at the wrong minute.
 */
export default function SimPage() {
  // The root layout locks the body for the landing's loader; nothing on this route is waiting for
  // one, and a locked body on a screen that may need to scroll below xl is a screen with a hidden
  // bottom half.
  useEffect(() => {
    document.body.classList.remove("locked");
  }, []);

  return (
    <ReplayProvider>
      {/* The screen is thirteen panels and no prose, so the document has no heading of its own: a
          screen reader arriving here finds a title and then a wall of numbers. Hidden visually
          rather than removed, because `display: none` is not read aloud either. */}
      <h1 className="sr-only">
        Zentis replay — one Aqua position across three chains, over a recorded moment
      </h1>
      <Screen />
      <div className="grain" />
      {/* The replay is a running clock; with no scripts there is nothing to run it. What goes here
          is the argument itself rather than an apology, because a reader who gets this far without
          scripts is still a reader. */}
      <noscript>
        <div className="mx-auto max-w-3xl p-8 text-fs-0 leading-relaxed text-ink-soft">
          <p className="m-0">
            Zentis runs one market-making position across three chains and rebalances it by pricing
            rather than by bridging: each leg quotes a signed tilt computed in a Chainlink
            confidential workflow, published to a registry, and read by custom SwapVM instructions on
            unmodified 1inch Aqua contracts. The legs lean against each other instead of moving
            inventory between them.
          </p>
          <p className="m-0 mt-3">
            This page replays a recorded moment from Sepolia, Base Sepolia and Arbitrum Sepolia — real
            reads, committed to the repository, not a simulation — and needs JavaScript to draw it.
            The same moment is on <a href="/console">the console</a>, and the numbers behind both are
            served as JSON from <a href="/api/replay">/api/replay</a>.
          </p>
        </div>
      </noscript>
    </ReplayProvider>
  );
}
