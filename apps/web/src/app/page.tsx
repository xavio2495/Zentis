import { CopyLink } from "@/components/CopyLink";
import { Cursor } from "@/components/Cursor";
import { HeroLines } from "@/components/HeroLines";
import { HeroWordmark } from "@/components/HeroWordmark";
import { InstallDock } from "@/components/InstallDock";
import { Nav } from "@/components/Nav";
import { Field } from "@/components/Field";
import { Loader } from "@/components/Loader";
import { Reveal } from "@/components/Reveal";
import { Smoother } from "@/components/Smoother";
import { COPY, INSTALL_COMMAND, INTEGRATIONS, REPO_LABEL, REPO_URL, ROUTES } from "@/lib/copy";

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

        <section id="position" className="mx-auto max-w-3xl px-8 py-[20vh]">
          <Reveal>
            <h2 className="serif text-fs-5 leading-tight text-ink md:text-fs-6">{COPY.statement}</h2>
            <p className="mt-8 text-fs-1 font-light leading-relaxed text-ink-soft">
              {COPY.statementBody}
            </p>
          </Reveal>
        </section>

        <section id="built-on" className="mx-auto max-w-5xl px-8 py-[12vh]">
          <Reveal>
            <p className="label">{COPY.integrationsLabel}</p>
            <ul className="mt-10 grid list-none grid-cols-1 gap-6 p-0 md:grid-cols-3">
              {INTEGRATIONS.map((integration) => (
                <li key={integration.name} className="relative border border-stroke p-6">
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

        {/* The outro: the field scatters as the page ends. */}
        <div aria-hidden="true" style={{ height: "60vh" }} />

        <section
          id="contact"
          className="flex min-h-[80vh] flex-col items-center justify-center gap-8 px-8 text-center"
        >
          <Reveal>
            <p className="serif text-fs-2 text-ink-soft md:text-fs-4">{COPY.contactLine}</p>
            <div className="mt-8">
              <CopyLink
                href={REPO_URL}
                label={REPO_LABEL}
                hint={COPY.contactHint}
                copied={COPY.contactCopied}
              />
            </div>
            <p className="mt-10 label-sm text-ink-faint">{COPY.routesLine}</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {ROUTES.map((route) => (
                <a
                  key={route.href}
                  href={route.href}
                  data-magnetic
                  className="nav-link text-fs-1 text-ink no-underline hover:text-ink"
                >
                  {route.label}
                  <span className="ml-2 text-fs-0 text-ink-faint">{route.blurb}</span>
                </a>
              ))}
            </div>
          </Reveal>
        </section>

        <footer className="flex min-h-[40vh] flex-col items-center justify-center gap-6 px-8 text-center">
          <Reveal>
            <p className="serif text-fs-2 text-ink-soft md:text-fs-3">{COPY.outro}</p>
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
