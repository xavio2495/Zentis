import { SPONSORS } from "@/lib/sponsors";

/**
 * The row that closes the page: who this was built on, and who it was built for.
 *
 * A sponsor with no mark on disk is set as its own name in the label token. That is deliberate and
 * it is the instruction: an absent logo should look absent, not be papered over with a redrawing or
 * with somebody else's file. When the official marks land, each entry gains a `file` and this
 * component needs no change.
 */
export function SponsorRow() {
  return (
    <ul className="m-0 flex list-none flex-wrap items-center justify-center gap-x-10 gap-y-6 p-0">
      {SPONSORS.map((sponsor) => (
        <li key={sponsor.name}>
          <a
            href={sponsor.href}
            rel="noreferrer"
            data-magnetic
            className="tap flex items-center text-ink-faint no-underline hover:text-ink-soft"
            aria-label={sponsor.name}
          >
            {sponsor.file === null ? (
              <span className="label-sm">{sponsor.name}</span>
            ) : (
              <img
                src={`/brand/sponsors/${sponsor.file}`}
                alt={sponsor.name}
                className={`h-6 w-auto ${sponsor.monochrome ? "opacity-80 [filter:grayscale(1)_brightness(1.6)]" : ""}`}
              />
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
