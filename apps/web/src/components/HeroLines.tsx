"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { markPosition } from "@/lib/mark-position";

/**
 * The two lines under the wordmark, each with a transparent copy behind it that
 * the mark lights as it passes. The copy is masked to a circle around the mark,
 * so only the part of the line it is actually behind comes up — the same trick
 * the wordmark uses letter by letter, but a line has no letters to divide.
 */
export function HeroLines({
  line,
  tagline,
}: {
  line: ReactNode;
  tagline: ReactNode;
}) {
  const lineGlow = useRef<HTMLParagraphElement>(null);
  const taglineGlow = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nodes = [lineGlow.current, taglineGlow.current].filter(Boolean) as HTMLElement[];
    if (nodes.length === 0) return;

    let raf = 0;
    const painted = nodes.map(() => -1);

    const frame = () => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const box = node.getBoundingClientRect();

        let strength = 0;
        if (markPosition.visible && markPosition.radius > 0) {
          // distance from the mark to the line's own box, zero when it is over it
          const outX = Math.max(0, Math.abs(markPosition.x - (box.left + box.width / 2)) - box.width / 2);
          const outY = Math.max(0, Math.abs(markPosition.y - (box.top + box.height / 2)) - box.height / 2);
          const away = Math.hypot(outX, outY);
          strength = Math.max(0, 1 - away / (markPosition.radius * 1.2 + 40));
        }

        const value = Math.round(strength * 20) / 20;
        if (painted[i] === value) continue;
        painted[i] = value;

        node.style.opacity = (value * 0.9).toFixed(2);
        if (value > 0) {
          const cx = Math.round(markPosition.x - box.left);
          const cy = Math.round(markPosition.y - box.top);
          const r = Math.round(markPosition.radius * 1.3);
          const mask = `radial-gradient(circle ${r}px at ${cx}px ${cy}px, #000 30%, transparent 100%)`;
          node.style.maskImage = mask;
          node.style.webkitMaskImage = mask;
        }
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <div className="hero-stack">
        <p ref={lineGlow} className="hero-line hero-line-glow rise-2" aria-hidden="true">
          {line}
        </p>
        <p className="hero-line rise-2">{line}</p>
      </div>
      <div className="hero-stack">
        <p ref={taglineGlow} className="hero-tagline serif hero-line-glow rise-3" aria-hidden="true">
          {tagline}
        </p>
        <p className="hero-tagline serif rise-3">{tagline}</p>
      </div>
    </>
  );
}
