"use client";

import { useEffect, useState } from "react";
import { COPY, LOADER_WORDS } from "@/lib/copy";

/**
 * Holds the first screen while the field is built, then hands over.
 *
 * It owns two body classes: `locked` comes off so the page can scroll, and
 * `ready` goes on, which is what releases the hero's entry animations. Nothing
 * animates during hydration because nothing is allowed to until that class
 * lands.
 */
export function Loader() {
  const [progress, setProgress] = useState(0);
  const [word, setWord] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // No mount guard: each run owns the frame it cancels, so a remount simply
    // restarts the count rather than leaving a cancelled loop behind.
    const start = performance.now();
    const duration = 1600;
    let frame = 0;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out, so the count decelerates into place rather than stopping dead
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(eased);
      setWord(Math.min(LOADER_WORDS.length - 1, Math.floor(eased * LOADER_WORDS.length)));
      if (t < 1) {
        frame = requestAnimationFrame(step);
        return;
      }
      document.body.classList.remove("locked");
      document.body.classList.add("ready");
      setDone(true);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="loader" data-done={done} aria-hidden="true">
      <div className="label absolute left-8 top-8 md:left-12 md:top-12">{COPY.wordmark}</div>

      <div className="absolute inset-0 flex items-center justify-center">
        {LOADER_WORDS.map((w, i) => (
          <span
            key={w}
            className="loader-word serif absolute"
            style={{
              opacity: i === word ? 1 : 0,
              transform: `translateY(${i === word ? 0 : i < word ? -20 : 20}px)`,
            }}
          >
            {w}
          </span>
        ))}
      </div>

      <div className="loader-count serif absolute bottom-8 right-8 text-ink md:bottom-12 md:right-12">
        {Math.round(progress * 100)
          .toString()
          .padStart(3, "0")}
      </div>

      <div className="loader-rail">
        <div className="loader-fill" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </div>
  );
}
