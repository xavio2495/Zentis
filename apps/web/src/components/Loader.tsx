"use client";

import { useEffect, useState } from "react";
import { COPY, LOADER_WORDS } from "@/lib/copy";
import { FADE_MS, loaderPhase, loaderProgress } from "@/lib/loader-phase";

/**
 * Holds the first screen while the field is built, then leaves.
 *
 * It owns two body classes: `locked` comes off so the page can scroll, and
 * `ready` goes on, which is what releases the hero's entry animations. Nothing
 * animates during hydration because nothing is allowed to until that class
 * lands. Once the fade is over the whole layer is removed — transparent is not
 * the same as gone.
 */
export function Loader() {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"counting" | "fading" | "gone">("counting");

  useEffect(() => {
    // No mount guard: each run owns the frame it cancels, so a remount simply
    // restarts the count rather than leaving a cancelled loop behind.
    const start = performance.now();
    let frame = 0;
    let released = false;

    const step = (now: number) => {
      const elapsed = now - start;
      const next = loaderPhase(elapsed);
      setProgress(loaderProgress(elapsed));
      setPhase(next);

      if (!released && next !== "counting") {
        released = true;
        document.body.classList.remove("locked");
        document.body.classList.add("ready");
        dispatchEvent(new Event("zentis:ready"));
      }

      if (next !== "gone") frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);

  if (phase === "gone") return null;

  // progress is already eased; the words simply divide it into three
  const word = Math.min(LOADER_WORDS.length - 1, Math.floor(progress * LOADER_WORDS.length));

  return (
    <div
      className="loader"
      data-done={phase === "fading"}
      aria-hidden="true"
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
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
