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
          {/* the gate, drawn rather than built out of points */}
          <svg
            viewBox="-58 -58 116 116"
            className="absolute left-1/2 top-1/2 h-[62vh] w-[62vh] -translate-x-1/2 -translate-y-1/2"
            style={{ overflow: "visible" }}
          >
            <defs>
              <linearGradient id="gate" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f5f5f5" stopOpacity="0.05" />
                <stop offset="100%" stopColor="#00ED64" stopOpacity="0.12" />
              </linearGradient>
            </defs>
            {/* equilateral, standing on its point: side 100, height 50*sqrt(3) */}
            <polygon points="-50,-43.3 50,-43.3 0,43.3" fill="url(#gate)" />
            <polygon
              points="-50,-43.3 50,-43.3 0,43.3"
              fill="none"
              stroke="#f5f5f5"
              strokeWidth="1.6"
              strokeOpacity="0.85"
            />
            <polygon
              points="-53.5,-46.3 53.5,-46.3 0,46.4"
              fill="none"
              stroke="#00ED64"
              strokeWidth="1"
              strokeOpacity="0.32"
            />
          </svg>

          <svg
            viewBox="0 0 1000 1000"
            className="absolute left-1/2 top-1/2 w-[min(18vh,26vw)] -translate-x-1/2 -translate-y-[42%]"
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
