"use client";

import { useEffect, useRef } from "react";
import { COPY } from "@/lib/copy";
import { letterGlow } from "@/lib/hero-glow";
import { markPosition } from "@/lib/mark-position";

const LETTERS = COPY.wordmark.split("");

/**
 * The wordmark, and a transparent copy of it lit letter by letter under the
 * cursor. The real letters brighten a little as the light reaches them, so the
 * word reads as being lit rather than as having something drawn over it.
 *
 * Both layers are rendered on the server, so the largest text on the first
 * screen is in the page source at its final metrics.
 */
export function HeroWordmark() {
  const glow = useRef<HTMLDivElement>(null);
  const real = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const glowNode = glow.current;
    const realNode = real.current;
    if (!glowNode || !realNode) return;
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let pointerX = -1e4;
    let pointerY = -1e4;
    let raf = 0;
    const eased = new Float32Array(LETTERS.length);
    const painted = new Float32Array(LETTERS.length).fill(-1);

    const onMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
    };

    const frame = () => {
      const box = realNode.getBoundingClientRect();
      const band = { centerY: box.top + box.height / 2, halfHeight: box.height / 2 };
      const glowLetters = glowNode.children;
      const realLetters = realNode.children;

      for (let i = 0; i < LETTERS.length; i++) {
        const node = realLetters[i] as HTMLElement | undefined;
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const fromCursor = letterGlow(pointerX, pointerY, { centerX, width: rect.width }, band);

        // The mark lights what it passes behind, as well as the cursor.
        let fromMark = 0;
        if (markPosition.visible && markPosition.radius > 0) {
          const reach = markPosition.radius * 1.5 + box.height * 0.3;
          const away = Math.hypot(markPosition.x - centerX, markPosition.y - centerY);
          fromMark = Math.max(0, 1 - away / reach) * 0.85;
        }

        const target = Math.min(1, Math.max(fromCursor, fromMark));

        // quick to light, slower to let go
        eased[i] += (target - eased[i]) * (target > eased[i] ? 0.22 : 0.07);

        // quantised, so a still cursor stops writing styles altogether
        const value = Math.round(eased[i] * 20) / 20;
        if (painted[i] === value) continue;
        painted[i] = value;
        (glowLetters[i] as HTMLElement).style.opacity = value.toFixed(2);
        node.style.color = `rgba(255,255,255,${(0.55 + 0.4 * value).toFixed(2)})`;
      }

      raf = requestAnimationFrame(frame);
    };

    addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div className="hero-stack">
      <div ref={glow} className="hero-name hero-name-glow rise-1" aria-hidden="true">
        {LETTERS.map((letter, i) => (
          <span key={`${letter}-${i}`}>{letter}</span>
        ))}
      </div>
      <h1 ref={real} className="hero-name rise-1" aria-label={COPY.wordmark}>
        {LETTERS.map((letter, i) => (
          <span key={`${letter}-${i}`}>{letter}</span>
        ))}
      </h1>
    </div>
  );
}
