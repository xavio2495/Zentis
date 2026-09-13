import type { Metadata } from "next";
import { DeckStage } from "@/components/deck/DeckStage";
import { INSTALL_COMMAND } from "@/lib/copy";
import { DECK_META, DECK_NOSCRIPT, SLIDES } from "@/lib/deck";

/**
 * Its own metadata, unlike the other two routes.
 *
 * `/console` and `/sim` are client components with no `metadata` export, so they inherit the
 * landing's title, description and canonical — which tells a crawler both are duplicates of the
 * root and gives all three the same link preview. A deck is the one page here most likely to be
 * pasted into a chat before it is opened, so it carries its own.
 */
export const metadata: Metadata = {
  title: DECK_META.title,
  description: DECK_META.description,
  alternates: { canonical: "/deck" },
  openGraph: {
    type: "article",
    url: "/deck",
    title: DECK_META.title,
    description: DECK_META.description,
  },
  twitter: { card: "summary_large_image", title: DECK_META.title, description: DECK_META.description },
};

/**
 * The pitch, as seven slides.
 *
 * A server component wrapping one client component, so the whole argument is in the HTML before any
 * script arrives. The `<noscript>` below is not a fallback notice: it is the deck, in order, as
 * readable text. A deck that exists only as animation cannot be linked, indexed, or opened by
 * somebody whose laptop is having a bad morning ten minutes before a demo.
 */
export default function DeckPage() {
  return (
    <>
      <noscript>
        <div className="mx-auto max-w-3xl px-8 py-16">
          <h1 className="serif text-fs-4 text-ink">{DECK_META.title}</h1>
          {SLIDES.map((slide) => (
            <section key={slide.id} className="mt-12">
              <p className="label text-ink-faint">{slide.kicker}</p>
              <h2 className="serif mt-3 text-fs-3 text-ink">{slide.title}</h2>
              <p className="mt-4 text-fs-0 font-light leading-relaxed text-ink-soft">{slide.body}</p>
              {slide.points ? (
                <ul className="mt-4 list-none p-0">
                  {slide.points.map((point) => (
                    <li key={point} className="mt-2 text-fs-0 font-light text-ink-soft">
                      — {point}
                    </li>
                  ))}
                </ul>
              ) : null}
              {slide.doors ? (
                <p className="mt-4 flex gap-6">
                  {slide.doors.map((door) => (
                    <a key={door.href} href={door.href} className="text-fs-0 text-ink">
                      {door.label}
                    </a>
                  ))}
                </p>
              ) : null}
            </section>
          ))}
          <p className="mt-12 font-mono text-fs-0 text-ink">{INSTALL_COMMAND}</p>
        </div>
      </noscript>

      <DeckStage />
    </>
  );
}
