import { BRIDGE, CHAIN_A, CHAIN_B } from "@/lib/mark-geometry";

/**
 * The mark, small, for a header that has no room for a particle field.
 *
 * The three paths are imported from `mark-geometry` — the same strings the landing's field samples
 * its points from — so redrawing the logo moves both surfaces at once. A pasted copy here would
 * have survived exactly until the first redraw.
 */
export function MarkGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1000 1000"
      aria-hidden
      focusable="false"
      className={`h-4 w-4 shrink-0 ${className}`}
      fill={className.includes("fill-") ? undefined : "currentColor"}
    >
      <path d={CHAIN_B} />
      <path d={BRIDGE} />
      <path d={CHAIN_A} />
    </svg>
  );
}
