"use client";

import { useEffect, useRef, useState } from "react";
import { BRIDGE, CHAIN_A, CHAIN_B } from "@/lib/mark-geometry";

/**
 * Holds the point field, and the mark itself when there is no WebGL to build it
 * from. three.js is imported on mount, so it lands in its own chunk and the page
 * is readable before it arrives.
 */
export function Field() {
  const host = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const node = host.current;
    if (!node) return;

    let teardown: (() => void) | undefined;
    let cancelled = false;

    import("./mark-field")
      .then(({ mountMarkField }) => {
        if (cancelled) return;
        teardown = mountMarkField(node);
        node.style.opacity = "1";
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, []);

  return (
    <div
      ref={host}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-2 opacity-0 transition-opacity duration-700"
      style={fallback ? { opacity: 1 } : undefined}
    >
      {fallback && (
        <>
          {/* the doorway, drawn rather than built out of points */}
          <svg
            viewBox="-54 -134 108 268"
            className="absolute left-1/2 top-1/2 h-[62vh] -translate-x-1/2 -translate-y-1/2"
            style={{ width: "calc(62vh / 2.6)", overflow: "visible" }}
          >
            <defs>
              <linearGradient id="doorway" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#7DF7AF" stopOpacity="0.16" />
                <stop offset="55%" stopColor="#f5f5f5" stopOpacity="0.05" />
                <stop offset="100%" stopColor="#f5f5f5" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <rect x="-50" y="-130" width="100" height="260" fill="url(#doorway)" />
            <rect
              x="-53.6"
              y="-132.6"
              width="107.2"
              height="265.2"
              fill="none"
              stroke="#7DF7AF"
              strokeWidth="1.1"
              strokeOpacity="0.38"
            />
            <rect
              x="-50"
              y="-130"
              width="100"
              height="260"
              fill="none"
              stroke="#f5f5f5"
              strokeWidth="1.8"
              strokeOpacity="0.9"
            />
          </svg>

          <svg
            viewBox="0 0 1000 1000"
            className="absolute left-1/2 top-1/2 w-[min(22vh,30vw)] -translate-x-1/2 -translate-y-1/2"
            style={{ filter: "drop-shadow(0 0 40px rgba(0, 237, 100, 0.18))" }}
          >
            <path d={CHAIN_A} fill="#d8d8d8" fillOpacity="0.55" />
            <path d={CHAIN_B} fill="#d8d8d8" fillOpacity="0.55" />
            <path d={BRIDGE} fill="#00ED64" fillOpacity="0.75" />
          </svg>
        </>
      )}
    </div>
  );
}
