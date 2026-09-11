import { CopyCommand } from "@/components/CopyCommand";
import { Field } from "@/components/Field";
import { Loader } from "@/components/Loader";
import { Reveal } from "@/components/Reveal";
import { COPY, INTEGRATIONS, INSTALL_COMMAND } from "@/lib/copy";

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

      <nav className="nav-diff fixed inset-x-0 top-0 z-60 flex items-center justify-between px-8 py-6 md:px-12">
        <a href="#hero" className="label text-ink no-underline">
          {COPY.wordmark}
        </a>
        <div className="hidden gap-8 text-fs-0 md:flex">
          <a href="#position" className="text-ink-soft no-underline transition-colors hover:text-ink">
            Position
          </a>
          <a href="#built-on" className="text-ink-soft no-underline transition-colors hover:text-ink">
            Built on
          </a>
          <a href="#install" className="text-ink-soft no-underline transition-colors hover:text-ink">
            Install
          </a>
        </div>
      </nav>

      <main className="relative z-3">
        {/* The first screen is server-rendered at its final metrics, so the
            wordmark is in the source and nothing shifts when React arrives. */}
        <section
          id="hero"
          className="flex h-screen flex-col items-center justify-center"
          style={{ height: "100svh" }}
        >
          <h1 className="hero-name rise-1">{COPY.wordmark}</h1>
          <p className="hero-line rise-2">{COPY.heroLine}</p>
          <p className="hero-tagline serif rise-3">{COPY.tagline}</p>
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
            <h2 className="serif text-fs-5 leading-tight text-em md:text-fs-6">{COPY.statement}</h2>
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

        <section id="install" className="mx-auto max-w-3xl px-8 py-[14vh]">
          <Reveal>
            <p className="label">{COPY.installLabel}</p>
            <div className="mt-8">
              <CopyCommand />
            </div>
          </Reveal>
        </section>

        {/* The outro: the field scatters as the page ends. */}
        <div aria-hidden="true" style={{ height: "60vh" }} />

        <footer className="flex min-h-[70vh] flex-col items-center justify-center gap-10 px-8 text-center">
          <Reveal>
            <p className="serif text-fs-2 text-ink-soft md:text-fs-4">{COPY.outro}</p>
          </Reveal>
          <p className="label-sm text-ink-faint">{COPY.footer}</p>
        </footer>
      </main>

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
