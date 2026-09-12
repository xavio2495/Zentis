"use client";

import { useEffect, useState } from "react";

/** A link that copies itself when clicked, and says so. */
export function CopyLink({
  href,
  label,
  hint,
  copied: copiedLabel,
}: {
  href: string;
  label: string;
  hint: string;
  copied: string;
}) {
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
        className="pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 text-em text-fs-0 transition-opacity duration-300"
        style={{ opacity: copied ? 1 : 0 }}
      >
        {copiedLabel}
      </span>

      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-magnetic
        onClick={(event) => {
          // copy on a plain click; let modified clicks open it as usual
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          navigator.clipboard?.writeText(href).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        className="block break-all font-bold text-fs-2 text-ink no-underline transition-colors hover:text-em md:text-fs-5"
      >
        {label}
      </a>

      <p className="label-sm mt-3 text-ink-faint">{hint}</p>
    </div>
  );
}
