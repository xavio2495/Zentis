"use client";

import { useEffect } from "react";
import { clearScrollSource, setScrollSource } from "@/lib/scroll";

/**
 * Smoothed scrolling, the way the reference does it: the content is moved by a
 * transform that eases toward the scrollbar's real position, so the page has
 * weight instead of stepping.
 *
 * Everything drawn outside the smoothed content follows the eased value rather
 * than the scrollbar — see lib/scroll. Skipped entirely when the reader has
 * asked for less motion, where native scrolling is the honest answer.
 */
export function Smoother() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // a coarse pointer means a touch device, where the platform's own momentum
    // is better than anything done here
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let destroy: (() => void) | undefined;
    let cancelled = false;

    Promise.all([
      import("gsap"),
      import("gsap/ScrollTrigger"),
      import("gsap/ScrollSmoother"),
    ]).then(([{ gsap }, { ScrollTrigger }, { ScrollSmoother }]) => {
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger, ScrollSmoother);

      const smoother = ScrollSmoother.create({
        wrapper: "#smooth-wrapper",
        content: "#smooth-content",
        smooth: 1.1,
        effects: false,
        normalizeScroll: false,
      });

      // the eased position, which is what the reader is actually looking at
      setScrollSource(() => -(gsap.getProperty("#smooth-content", "y") as number));

      // the loader holds the page still while it runs, so the measurements it
      // would take before that are the wrong ones
      const refresh = () => ScrollTrigger.refresh();
      addEventListener("zentis:ready", refresh);

      destroy = () => {
        removeEventListener("zentis:ready", refresh);
        clearScrollSource();
        smoother.kill();
      };
    });

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);

  return null;
}
