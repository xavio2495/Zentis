"use client";

import { useEffect, useState } from "react";
import { COPY } from "@/lib/copy";

const SECTIONS = [
  { id: "position", label: "Position" },
  { id: "built-on", label: "Built on" },
  { id: "install", label: "Install" },
  { id: "contact", label: "Source" },
];

/** The nav, with the section the reader is in marked. */
export function Nav() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );

    for (const section of SECTIONS) {
      const node = document.getElementById(section.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="nav-diff fixed inset-x-0 top-0 z-60 flex items-center justify-between px-8 py-6 md:px-12">
      <a href="#hero" className="label text-ink no-underline" data-magnetic>
        {COPY.wordmark}
      </a>
      <div className="hidden gap-8 text-fs-0 md:flex">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            data-magnetic
            className={`nav-link text-ink-soft no-underline transition-colors hover:text-ink ${
              active === section.id ? "on" : ""
            }`}
          >
            {section.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
