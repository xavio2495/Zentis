"use client";

import { useEffect } from "react";
import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@/components/console/Terminal";
import { BRIDGE, CHAIN_A, CHAIN_B } from "@/lib/mark-geometry";
import { INSTALL_COMMAND, ROUTES } from "@/lib/copy";

/**
 * The console itself, not a description of one.
 *
 * The replay at `/sim` is a screen built for a reader in forty seconds. This is the tool the maker
 * actually runs, on the same recorded moment: every key it offers, every page behind them, and the
 * reasons the ones that sign are disabled.
 *
 * A bar and the terminal, and nothing else. Everything a reader needs to know about what they are
 * looking at — that the moment is recorded, which keys exist, why the signing ones are disabled —
 * the console says itself, in its own status bar. A footer saying it again in the page's voice is a
 * second place to edit and a second thing to be wrong.
 */

/**
 * The mark, from the same three paths the landing's field samples.
 *
 * In the accent whole: on the landing the connector is picked out because the surrounding
 * near-white chains give it something to be picked out of, and on a bare bar there is nothing to
 * contrast with — a two-tone mark at sixteen pixels reads as a smudge.
 */
function Mark() {
  return (
    <svg viewBox="0 0 1000 1000" className="h-5 w-5 fill-em" aria-hidden="true">
      <path d={CHAIN_B} />
      <path d={BRIDGE} />
      <path d={CHAIN_A} />
    </svg>
  );
}

export default function ConsolePage() {
  useEffect(() => {
    document.body.classList.remove("locked");
  }, []);

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-stroke px-4">
        <a href="/" className="flex items-center gap-3 no-underline" aria-label="Zentis">
          <Mark />
          <span className="label text-ink">ZENTIS</span>
        </a>
        {/* The other route, after a rule: /sim's bar carries the link to here, and this is the
            other half of that pair. A reader who finds one should not have to guess at the other. */}
        <span aria-hidden className="h-4 w-px bg-stroke" />
        <a href="/sim" className="label-sm tap whitespace-nowrap text-ink-faint no-underline hover:text-ink">
          {ROUTES.find((route) => route.href === "/sim")?.label}
        </a>
        <span className="flex-1" />
        {/* The keyboard is the whole interface here and it is live from the moment the page loads.
            Said out loud because a terminal in a page looks exactly like a picture of one, and the
            keys are listed along the bottom of the console where a reader has no reason to trust
            they do anything. */}
        <span className="label-sm text-ink-faint">the keys are live · ? for help</span>
      </header>
      {/* Drawn into a canvas, so the document has no heading of its own: a screen reader arriving
          here finds a page with a title and nothing under it. Hidden visually rather than removed,
          because `display: none` is not read aloud either. */}
      <h1 className="sr-only">Zentis console — three chains as one position, on a recorded moment</h1>
      <main className="min-h-0 flex-1 p-2">
        <Terminal />
      </main>
      {/* The console is a terminal application; without scripts there is nothing to draw it with.
          Saying so beats an empty black page, and the install line is the honest answer to what to
          do instead — it is the same console, on the reader's own machine. */}
      <noscript>
        <div className="border-t border-stroke p-4 text-fs-0 leading-relaxed text-ink-soft">
          <p className="m-0">
            This page runs the Zentis operator console — the real terminal application, compiled for
            the browser, over a committed recording of three testnets. It needs JavaScript to draw.
          </p>
          <p className="m-0 mt-2">
            To run the same console on your own machine: <code className="font-mono text-ink">{INSTALL_COMMAND}</code>
          </p>
        </div>
      </noscript>
    </div>
  );
}
