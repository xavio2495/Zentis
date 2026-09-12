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
      <Screen />
      <div className="grain" />
    </ReplayProvider>
  );
}
