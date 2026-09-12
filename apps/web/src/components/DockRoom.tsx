"use client";

import { useEffect, useRef } from "react";
import { clearDockTarget, setDockTarget } from "@/lib/dock";

/**
 * The hole the install line arrives in.
 *
 * The line is fixed, so it cannot be laid out between the title and the buttons the way everything
 * else on the page is. Instead this keeps the room open and publishes its middle every frame, and
 * the line eases to that — which is how the title stays above it and the buttons stay below it at
 * any scroll position, rather than only at the one where the section happened to be centred.
 */
export function DockRoom() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;

    let raf = 0;
    const frame = () => {
      const box = node.getBoundingClientRect();
      // The gap's middle, and the top of the section's content — which is where the heading is, and
      // the thing the line must never be drawn beside.
      const section = node.closest("section");
      const top = section ? section.getBoundingClientRect().top : box.top;
      setDockTarget(box.top + box.height / 2, top);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      clearDockTarget();
    };
  }, []);

  return <div ref={host} aria-hidden className="dock-room" />;
}
