"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CopyCommand } from "@/components/CopyCommand";
import { Field } from "@/components/Field";
import { Reveal } from "@/components/Reveal";
import { INSTALL_COMMAND, REPO_LABEL, REPO_URL } from "@/lib/copy";
import { SLIDES, nextIndex } from "@/lib/deck";

/** How far a thumb has to travel before it counts as a swipe rather than a tap. */
const SWIPE_PX = 48;

/**
 * The deck, driven.
 *
 * Snapping is the stylesheet's job and moving between slides is this component's, which is why the
 * two are separate: `scroll-snap` alone gives a reader with a trackpad the right behaviour for
 * free, and a presenter with a laptop and no trackpad hand needs the arrow keys to do exactly the
 * same thing. Both end up calling `scrollIntoView` on the same section, so there is one path to be
 * right about rather than two.
 *
 * Where the deck currently is comes from an observer over the sections rather than from the key
 * handler's own count. A presenter who scrolls with two fingers and then reaches for the arrow key
 * must not find the deck jumping back to wherever the last key press thought it was.
 */
export function DeckStage() {
  const [index, setIndex] = useState(0);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const touchStart = useRef<number | null>(null);

  // The root layout locks the body for the landing's loader. This route has no loader and its own
  // scroller, and a locked body would leave every slide after the first unreachable.
  useEffect(() => {
    document.body.classList.remove("locked");
  }, []);

  const goTo = useCallback((target: number) => {
    const node = sections.current[target];
    if (!node) return;
    // Every other motion on this site asks first, and a smooth scroll is motion: for a reader who
    // has asked for less of it, a deck that eases through a whole viewport on every arrow press is
    // the worst offender on the page rather than the one exception to the rule.
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }, []);

  // The live position, read from what is actually on screen.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const at = sections.current.indexOf(entry.target as HTMLElement);
          if (at >= 0) setIndex(at);
        }
      },
      { threshold: 0.55 },
    );
    for (const node of sections.current) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // A modifier means the reader is talking to the browser, not to the deck.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // And a key pressed inside something that takes typing belongs to that thing.
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      const to = nextIndex(index, event.key, SLIDES.length);
      if (to === index) return;
      event.preventDefault();
      goTo(to);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, goTo]);

  // A click anywhere advances, which is what a presenter's hand does without being told. Anything
  // interactive keeps its own click: the install line on the last slide is there to be copied.
  const onClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, [data-no-advance]")) return;
    goTo(nextIndex(index, "ArrowRight", SLIDES.length));
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    const from = touchStart.current;
    touchStart.current = null;
    if (from === null) return;
    const delta = from - event.changedTouches[0].clientY;
    if (Math.abs(delta) < SWIPE_PX) return;
    goTo(nextIndex(index, delta > 0 ? "ArrowRight" : "ArrowLeft", SLIDES.length));
  };

  return (
    <>
      <Field />
      <div className="grain" />

      {/* The rail is the only chrome: where the deck is, and how much is left. Buttons rather than
          marks, because a presenter who has lost their place wants to jump, not to arrow back. */}
      <nav aria-label="Slides" className="fixed right-6 top-1/2 z-60 hidden -translate-y-1/2 flex-col gap-3 md:flex">
        {SLIDES.map((slide, at) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => goTo(at)}
            aria-label={slide.title}
            aria-current={at === index ? "true" : undefined}
            className={`h-px w-6 border-0 p-0 transition-all duration-500 ${
              at === index ? "w-10 bg-ink" : "bg-stroke hover:bg-ink-faint"
            }`}
          />
        ))}
      </nav>

      <main
        className="relative z-3 h-[100svh] snap-y snap-mandatory overflow-y-scroll"
        onClick={onClick}
        onTouchStart={(event) => (touchStart.current = event.touches[0].clientY)}
        onTouchEnd={onTouchEnd}
      >
        {SLIDES.map((slide, at) => (
          <section
            key={slide.id}
            id={slide.id}
            ref={(node) => {
              sections.current[at] = node;
            }}
            className="flex h-[100svh] snap-start items-center px-8 md:px-16"
          >
            <Reveal className="mx-auto w-full max-w-4xl">
              <p className="label text-ink-faint">{slide.kicker}</p>
              <h2 className="serif mt-6 text-fs-5 leading-tight text-ink md:text-fs-6">{slide.title}</h2>
              <p className="mt-8 max-w-3xl text-fs-1 font-light leading-relaxed text-ink-soft">{slide.body}</p>
              {slide.points ? (
                <ul className="mt-10 grid list-none grid-cols-1 gap-4 p-0">
                  {slide.points.map((point) => (
                    <li
                      key={point}
                      className="border-l border-stroke pl-5 text-fs-0 font-light leading-relaxed text-ink-soft"
                    >
                      {point === INSTALL_COMMAND ? (
                        <span data-no-advance>
                          <CopyCommand />
                        </span>
                      ) : point === REPO_LABEL ? (
                        <a href={REPO_URL} rel="noreferrer" className="nav-link text-ink-soft no-underline hover:text-ink">
                          {point}
                        </a>
                      ) : (
                        point
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Reveal>
          </section>
        ))}
      </main>
    </>
  );
}
