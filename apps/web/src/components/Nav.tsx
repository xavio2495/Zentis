"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { COPY, REPO_URL, ROUTES } from "@/lib/copy";
import { scrollToTarget } from "@/lib/scroll";

const SECTIONS = [
  { id: "position", label: "Position" },
  { id: "built-on", label: "Built on" },
  { id: "contact", label: "Try it" },
];

/**
 * Take a click to the place it names.
 *
 * The hash is still set, so the address bar and the back button behave and a link can be shared.
 * What changes is that something actually scrolls: the smoother is asked first, and where there is
 * no smoother — reduced motion, or a touch device — the default is left alone, because native
 * anchor scrolling is already right in exactly those cases.
 */
function goTo(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
  // A modified click is the reader asking for a new tab or a download; it is not ours to take.
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (!scrollToTarget(`#${id}`)) return;
  event.preventDefault();
  history.pushState(null, "", `#${id}`);
}

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
      {/* The mark rather than the word: it is the same three shapes the field spends the whole
          page assembling, so the nav and the hero are saying one thing. */}
      <a
        href="#hero"
        onClick={(event) => goTo(event, "hero")}
        aria-label="Zentis"
        className="no-underline"
        data-magnetic
      >
        <BrandMark className="h-5 w-5" />
      </a>
      <div className="hidden gap-8 text-fs-0 md:flex">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={(event) => goTo(event, section.id)}
            data-magnetic
            className={`nav-link text-ink-soft no-underline transition-colors hover:text-ink ${
              active === section.id ? "on" : ""
            }`}
          >
            {section.label}
          </a>
        ))}
        {/* After the anchors, and marked off from them: the sections above are the argument, these
            two are where it is running. A reader who wants the evidence rather than the pitch
            should not have to guess a URL. */}
        <span aria-hidden className="h-4 w-px self-center bg-stroke" />
        {/* The repo, which the closing section no longer carries: a nav entry that leads nowhere
            real is worse than one more link. */}
        <a
          href={REPO_URL}
          data-magnetic
          rel="noreferrer"
          className="nav-link text-ink-soft no-underline hover:text-ink"
        >
          Source
        </a>
        {ROUTES.map((route) => (
          <a
            key={route.href}
            href={route.href}
            data-magnetic
            title={route.blurb}
            className="nav-link text-ink-soft no-underline hover:text-ink"
          >
            {route.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
