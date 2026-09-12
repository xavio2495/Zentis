"use client";

import { useEffect } from "react";
import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@/components/console/Terminal";

/**
 * The console itself, not a description of one.
 *
 * The replay at `/sim` is a screen built for a reader in forty seconds. This is the tool the maker
 * actually runs, on the same recorded moment: every key it offers, every page behind them, and the
 * reasons the ones that sign are disabled.
 */
export default function ConsolePage() {
  useEffect(() => {
    document.body.classList.remove("locked");
  }, []);

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-stroke px-4">
        <div className="flex items-baseline gap-3">
          <span className="label text-ink">Zentis</span>
          <span className="label-sm text-ink-faint">the operator&rsquo;s console · recorded moment</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/sim" className="label-sm text-ink-faint no-underline transition-colors hover:text-ink">
            replay →
          </a>
          <a href="/" className="label-sm text-ink-faint no-underline transition-colors hover:text-ink">
            home →
          </a>
        </div>
      </header>
      <main className="min-h-0 flex-1 p-2">
        <Terminal />
      </main>
      <footer className="flex h-9 shrink-0 items-center gap-3 border-t border-stroke bg-inset px-4">
        <span className="label-sm text-ink-faint">
          this build reads nothing: it draws a committed recording of the three testnets, and nothing here signs
        </span>
      </footer>
    </div>
  );
}
