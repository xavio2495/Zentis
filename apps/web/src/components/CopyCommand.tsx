"use client";

import { useEffect, useState } from "react";
import { COPY, INSTALL_COMMAND } from "@/lib/copy";

/** The install line, copied to the clipboard on click. */
export function CopyCommand() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="relative inline-block max-w-full">
      <span
        role="status"
        className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 text-em text-fs-0 transition-opacity duration-300"
        style={{ opacity: copied ? 1 : 0 }}
      >
        {COPY.installCopied}
      </span>

      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(INSTALL_COMMAND).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        className="group flex max-w-full items-center gap-3 border border-stroke px-5 py-4 text-left transition-colors hover:border-ink-faint"
      >
        <span className="text-ink-faint select-none">$</span>
        <code className="overflow-x-auto whitespace-nowrap font-mono text-fs-0 text-ink md:text-fs-1">
          {INSTALL_COMMAND}
        </code>
      </button>

      <p className="label-sm mt-3 text-ink-faint">{COPY.installHint}</p>
    </div>
  );
}
