"use client";

import { useEffect, useRef, useState } from "react";
import { COPY, INSTALL_COMMAND } from "@/lib/copy";
import { dockClearance, dockNow, dockRect } from "@/lib/dock";
import { fieldState } from "@/lib/field-state";
import { scrollNow } from "@/lib/scroll";

/**
 * The install line, riding at the foot of the page and coming to the middle as
 * the page closes — where the mark comes apart around it.
 *
 * It has no border of its own: the field draws one out of points, which is why
 * it publishes where it is on every frame.
 */
export function InstallDock() {
  const host = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;

    let raf = 0;
    const frame = () => {
      const { installDock } = fieldState({
        scrollY: scrollNow(),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        docHeight: document.documentElement.scrollHeight,
      });

      const height = node.offsetHeight || 1;
      const atFoot = innerHeight - 40 - height / 2;
      // One place at a time: the foot, or the section's gap, and nothing drawn in between. dock.ts.
      const { y, opacity } = dockNow(atFoot, innerHeight);

      // And whether anything the page is showing wants that room. Content marks itself rather than
      // being listed here, so a figure added later is covered without touching this file.
      const line = { top: y - height / 2, bottom: y + height / 2 };
      const content = [...document.querySelectorAll("[data-dock-clear]")].map((el) => {
        const box = el.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      });
      const shown = Math.min(opacity, dockClearance(line, content));

      node.style.opacity = shown.toFixed(3);
      node.style.pointerEvents = shown < 0.5 ? "none" : "auto";
      const scale = 1 + installDock * 0.14;

      node.style.transform = `translate(-50%, -50%) translate(0, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`;

      const box = node.getBoundingClientRect();
      dockRect.left = box.left;
      dockRect.top = box.top;
      dockRect.width = box.width;
      dockRect.height = box.height;
      // The field draws the line's border out of points; a faded line has no border to draw.
      dockRect.on = box.width > 0 && shown > 0.5;

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    const onEnter = () => {
      dockRect.hovered = true;
    };
    const onLeave = () => {
      dockRect.hovered = false;
    };
    node.addEventListener("pointerenter", onEnter);
    node.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      node.removeEventListener("pointerenter", onEnter);
      node.removeEventListener("pointerleave", onLeave);
      dockRect.on = false;
      dockRect.hovered = false;
    };
  }, []);

  return (
    <div ref={host} className="install-dock">
      <button
        type="button"
        data-magnetic
        title={COPY.installHint}
        aria-label={COPY.installHint}
        onClick={() => {
          navigator.clipboard?.writeText(INSTALL_COMMAND).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        className="flex max-w-[92vw] items-center gap-4 px-6 py-4 text-left"
      >
        <span className="select-none text-ink-faint">$</span>
        <code className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-fs-0 text-ink">
          {INSTALL_COMMAND}
        </code>
        <span className={`dock-icon ${copied ? "done" : ""}`} aria-hidden="true">
          {copied ? (
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" stroke="currentColor">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path
                strokeLinecap="round"
                d="M5 15V6a2 2 0 0 1 2-2h9"
              />
            </svg>
          )}
        </span>
      </button>
    </div>
  );
}
