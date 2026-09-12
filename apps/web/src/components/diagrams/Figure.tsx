import type { ReactNode } from "react";

/**
 * The frame every diagram on the landing page sits in.
 *
 * A caption and a source, always, in that order and in mono. The prose on this page carries no
 * figures at all — that rule is enforced by test — so the diagrams are the only place a number
 * appears, and a number without its unit and its provenance is exactly the thing the rule exists to
 * prevent. The frame makes it impossible to draw one without saying where it came from.
 */
export function Figure({
  caption,
  source,
  children,
}: {
  caption: string;
  /** where these numbers were read, said in the reader's words rather than a file path */
  source: string;
  children: ReactNode;
}) {
  return (
    <figure className="m-0">
      {children}
      <figcaption className="mt-4 flex flex-col gap-1">
        <span className="text-fs-0 leading-snug text-ink-soft">{caption}</span>
        <span className="tnum font-mono text-[10px] leading-snug text-ink-faint">{source}</span>
      </figcaption>
    </figure>
  );
}

/** A signed basis-point figure, in the mono the rest of the project says numbers in. */
export const bps = (value: number): string => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}`;
