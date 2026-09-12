import { Cursor } from "@/components/Cursor";
import { MidAndLegs } from "@/components/diagrams/MidAndLegs";
import { NoBridge } from "@/components/diagrams/NoBridge";
import { Spread } from "@/components/diagrams/Spread";
import { Tilt } from "@/components/diagrams/Tilt";
import { readMoment } from "@/lib/moment";
import { DockRoom } from "@/components/DockRoom";
import { HeroLines } from "@/components/HeroLines";
import { HeroWordmark } from "@/components/HeroWordmark";
import { InstallDock } from "@/components/InstallDock";
import { Nav } from "@/components/Nav";
import { Field } from "@/components/Field";
import { Loader } from "@/components/Loader";
import { Reveal } from "@/components/Reveal";
import { SponsorRow } from "@/components/SponsorRow";
import { Smoother } from "@/components/Smoother";
import { COPY, INSTALL_COMMAND, INTEGRATIONS, ROUTES } from "@/lib/copy";

/** The four corner brackets that stand in for a card border. */
function Brackets() {
  return (
    <>
      <span className="bracket left-0 top-0 border-l-2 border-t-2" />
      <span className="bracket right-0 top-0 border-r-2 border-t-2" />
      <span className="bracket bottom-0 left-0 border-b-2 border-l-2" />
      <span className="bracket bottom-0 right-0 border-b-2 border-r-2" />
    </>
  );
}

export default function Home() {
  // Read on the server at build time: the drawings take real numbers, none of them typed.
  const moment = readMoment();
  return (
    <>
      <Loader />
      <Field />
      <div className="grain" />
      <Cursor />
      <InstallDock />
      <Smoother />

      <Nav />

      <div id="smooth-wrapper">
        <div id="smooth-content">
      <main className="relative z-3">
        {/* The first screen is server-rendered at its final metrics, so the
            wordmark is in the source and nothing shifts when React arrives. */}
        <section
          id="hero"
          className="relative flex h-screen flex-col items-center justify-center"
          style={{ height: "100svh" }}
        >
          <HeroWordmark />
          <HeroLines line={COPY.heroLine} tagline={COPY.tagline} />
          <div className="rise-4 absolute bottom-8 opacity-0">
            <svg
              className="pulse-soft h-6 w-6 stroke-ink-faint"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
        </section>

        {/* The traverse: the field comes toward the reader and opens out. */}
        <div aria-hidden="true" style={{ height: "120vh" }} />

        {/*
          The middle of the page is asymmetric, the way the reference is: nothing between the hero
          and the close sits in the centre. Each figure takes one side and leaves the other to the
          field, and the side alternates, so the mark has somewhere to be on every screen rather
          than being pushed behind the words.
        */}
        <section id="position" className="mx-auto w-full max-w-6xl px-8 py-[10vh]">
          <Reveal>
            <div data-dock-clear className="max-w-2xl">
              <h2 className="serif text-fs-5 leading-tight text-ink md:text-fs-6">{COPY.statement}</h2>
              <p className="mt-6 text-fs-1 font-light leading-relaxed text-ink-soft">{COPY.statementLead}</p>
            </div>
            <div data-dock-clear className="mt-12 max-w-2xl">
              <MidAndLegs moment={moment} />
            </div>
          </Reveal>
        </section>

        <section id="quote" className="mx-auto w-full max-w-6xl px-8 py-[10vh]">
          <Reveal>
            {/* The opposite side, so the field changes hands as the reader descends. */}
            <div data-dock-clear className="ml-auto max-w-2xl">
              <p className="label text-ink-faint">{COPY.mechanismLabel}</p>
              <p className="mt-4 text-fs-1 font-light leading-relaxed text-ink-soft">{COPY.mechanismLead}</p>
              <div className="mt-10">
                <Tilt moment={moment} />
              </div>
            </div>
          </Reveal>
        </section>

        <section id="spread" className="mx-auto w-full max-w-6xl px-8 py-[10vh]">
          <Reveal>
            <div data-dock-clear className="max-w-2xl">
              <Spread moment={moment} />
            </div>
          </Reveal>
        </section>

        <section id="dial" className="mx-auto w-full max-w-6xl px-8 py-[10vh]">
          <Reveal>
            <div data-dock-clear className="ml-auto max-w-2xl">
              <p className="label text-ink-faint">{COPY.dialLabel}</p>
              <p className="mt-4 text-fs-1 font-light leading-relaxed text-ink-soft">{COPY.dialLead}</p>
              <div className="mt-10">
                <NoBridge moment={moment} />
              </div>
            </div>
          </Reveal>
        </section>

        <section id="built-on" className="mx-auto max-w-5xl px-8 py-[10vh]">
          <Reveal>
            <p className="label">{COPY.integrationsLabel}</p>
            {/* Staggered, not a centred row: left, right, left, the way the reference alternates
                its project cards down the page. */}
            <ul className="mt-10 flex list-none flex-col gap-8 p-0">
              {INTEGRATIONS.map((integration, i) => (
                <li
                  data-dock-clear
                  key={integration.name}
                  className={`relative border border-stroke p-6 md:max-w-md ${
                    i % 2 === 1 ? "md:ml-auto md:mr-0" : "md:ml-0 md:mr-auto"
                  }`}
                >
                  <Brackets />
                  <p className="label-sm text-ink-faint">{integration.role}</p>
                  <h3 className="serif mt-2 text-fs-3">{integration.name}</h3>
                  <p className="mt-4 text-fs-0 font-light leading-relaxed text-ink-soft">
                    {integration.claim}
                  </p>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        {/* The outro: the field scatters as the page ends. Short, because a whole viewport of
            nothing but the scattered mark is dead space rather than a pause — the scatter reads
            in the room the close leaves around its own words. */}
        <div aria-hidden="true" style={{ height: "22vh" }} />

        {/*
          The close: one invitation, the command, and the two places it runs.

          It used to carry a serif line, the repo link, a label and two blurbs stacked above the
          install command — six things competing for the last screen the reader sees. The command is
          what this section is for; everything else here either points at it or points past it.
        */}
        <section
          id="contact"
          className="flex min-h-[62vh] flex-col items-center justify-center px-8 text-center"
        >
          <Reveal>
            <h2 className="serif text-fs-3 text-ink md:text-fs-5">{COPY.tryItOut}</h2>

            {/*
              The install line is the dock, which is fixed and eases to the middle of the viewport
              as the page closes. This holds that room open: anything placed here would sit
              underneath it.
            */}
            <DockRoom />

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              {/* Two doors, not three: the close asks the reader to run the thing, and the deck is
                  for a room with a presenter in it. It is in the nav instead. */}
              {ROUTES.filter((route) => route.atClose).map((route) => (
                <a key={route.href} href={route.href} data-magnetic className="cta">
                  {route.label}
                </a>
              ))}
            </div>
          </Reveal>
        </section>

        <footer className="flex min-h-[38vh] flex-col items-center justify-center gap-6 px-8 text-center">
          <Reveal>
            <SponsorRow />
          </Reveal>
          <p className="label-sm text-ink-faint">{COPY.footer}</p>
        </footer>
      </main>
        </div>
      </div>

      <noscript>
        <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center gap-6 bg-bg px-8 text-center">
          <p className="label">{COPY.wordmark}</p>
          <h1 className="text-fs-4 font-extrabold md:text-fs-6">{COPY.statement}</h1>
          <p className="max-w-[60ch] text-fs-1 font-light leading-relaxed text-ink-soft">
            {COPY.noscript}
          </p>
          <code className="font-mono text-fs-0 text-ink">{INSTALL_COMMAND}</code>
        </div>
      </noscript>
    </>
  );
}
