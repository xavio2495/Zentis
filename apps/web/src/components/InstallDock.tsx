"use client";

import { useEffect, useRef, useState } from "react";
import { COPY, INSTALL_COMMAND } from "@/lib/copy";
import { dockRect } from "@/lib/dock";
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
      const atCentre = innerHeight / 2;
      const y = atFoot + (atCentre - atFoot) * installDock;
      const scale = 1 + installDock * 0.14;

      node.style.transform = `translate(-50%, -50%) translate(0, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`;

      const box = node.getBoundingClientRect();
      dockRect.left = box.left;
      dockRect.top = box.top;
      dockRect.width = box.width;
      dockRect.height = box.height;
      dockRect.on = box.width > 0;

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      dockRect.on = false;
    };
  }, []);

  return (
    <div ref={host} className="install-dock">
      <span
        role="status"
        className="pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 text-em text-fs-0 transition-opacity duration-300"
        style={{ opacity: copied ? 1 : 0 }}
      >
        {COPY.installCopied}
      </span>

      <button
        type="button"
        data-magnetic
        onClick={() => {
          navigator.clipboard?.writeText(INSTALL_COMMAND).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        className="flex max-w-[92vw] items-center gap-3 px-6 py-4 text-left"
      >
        <span className="select-none text-ink-faint">$</span>
        <code className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-fs-0 text-ink">
          {INSTALL_COMMAND}
        </code>
      </button>

      <p className="label-sm mt-2 text-center text-ink-faint">{COPY.installHint}</p>
    </div>
  );
}
