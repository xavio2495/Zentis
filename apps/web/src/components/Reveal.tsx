"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The page's one reveal: blur and lift resolving as a section arrives. Reduced
 * motion is handled in the stylesheet, so this only ever adds a class.
 */
export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`fade-blur ${className}`}>
      {children}
    </div>
  );
}
