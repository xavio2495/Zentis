import { BRIDGE, CHAIN_A, CHAIN_B } from "@/lib/mark-geometry";

/**
 * The mark as the brand draws it: the accent as a field, the three shapes knocked out of it.
 *
 * Inline rather than an `<img>` so it takes the tokens — the knockout is the page's own background,
 * not a baked black, which means the mark sits on whatever surface it is put on. The geometry is
 * imported from `mark-geometry`, the same three paths the particle field samples and the console's
 * glyph draws, so there is one logo and it cannot fork.
 */
export function BrandMark({ className = "", title = "Zentis" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 1000 1000" role="img" aria-label={title} className={`shrink-0 ${className}`}>
      <rect width="1000" height="1000" fill="var(--color-em)" />
      <path d={CHAIN_A} fill="var(--color-bg)" fillRule="evenodd" clipRule="evenodd" />
      <path d={BRIDGE} fill="var(--color-bg)" />
      <path d={CHAIN_B} fill="var(--color-bg)" fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}
