"use client";

import { useEffect, useRef } from "react";

const TRAIL = 8;

/**
 * The page's own cursor: a dot, a ring that lags behind it, and a short trail.
 *
 * All three are drawn in difference blend, so they stay visible over both the
 * black field and the wordmark without needing to know what is under them. The
 * ring widens and takes the accent over anything marked interactive. Absent
 * entirely on touch, and on a machine asked for less motion.
 */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const trail = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const dotNode = dot.current;
    const ringNode = ring.current;
    if (!dotNode || !ringNode) return;

    document.body.classList.add("has-cursor");

    let x = innerWidth / 2;
    let y = innerHeight / 2;
    let ringX = x;
    let ringY = y;
    let raf = 0;
    let previous = performance.now();
    const history: { x: number; y: number }[] = Array.from({ length: TRAIL }, () => ({ x, y }));

    const onMove = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      dotNode.style.opacity = "1";
      ringNode.style.opacity = "1";

      const over = (event.target as Element | null)?.closest?.("a, button, [data-magnetic]");
      ringNode.classList.toggle("over", !!over);
    };

    const onLeave = () => {
      dotNode.style.opacity = "0";
      ringNode.style.opacity = "0";
    };

    const frame = (now: number) => {
      const delta = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      const settle = 1 - Math.exp(-11 * delta);

      ringX += (x - ringX) * settle;
      ringY += (y - ringY) * settle;

      dotNode.style.transform = `translate(${x}px, ${y}px)`;
      ringNode.style.transform = `translate(${ringX}px, ${ringY}px)`;

      // the trail is the ring's own path, sampled a few frames apart
      history.unshift({ x: ringX, y: ringY });
      history.length = TRAIL;
      for (let i = 0; i < TRAIL; i++) {
        const node = trail.current[i];
        const point = history[i];
        if (!node || !point) continue;
        node.style.transform = `translate(${point.x}px, ${point.y}px)`;
        node.style.opacity = (0.28 * (1 - i / TRAIL)).toFixed(3);
      }

      raf = requestAnimationFrame(frame);
    };

    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerleave", onLeave);
      document.body.classList.remove("has-cursor");
    };
  }, []);

  return (
    <div aria-hidden="true">
      {Array.from({ length: TRAIL }, (_, i) => (
        <div
          key={i}
          ref={(node) => {
            trail.current[i] = node;
          }}
          className="cur-trail"
        />
      ))}
      <div ref={ring} className="cur-ring" style={{ opacity: 0 }} />
      <div ref={dot} className="cur-dot" style={{ opacity: 0 }} />
    </div>
  );
}
