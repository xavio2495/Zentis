/**
 * Who this was built on, and who it was built for.
 *
 * `file` is the mark to draw, or null where there is none on disk. Null is not a placeholder to be
 * filled in with something approximate: a missing mark is shown as the sponsor's name in the label
 * token, so it reads as an absence rather than quietly becoming a redrawn or borrowed logo. Every
 * file that does exist carries a sidecar recording where it came from and what its guidelines
 * permit, which is what `tests/sponsors.test.ts` checks.
 *
 * `monochrome` says whether that brand allows its mark in a single colour. Several do not, and the
 * row sets only the ones that do in --text-soft, leaving the rest in their own colours.
 */
export interface Sponsor {
  readonly name: string;
  readonly href: string;
  /** path under public/brand/sponsors, or null when we do not have the official mark */
  readonly file: string | null;
  readonly monochrome: boolean;
}

export const SPONSORS: Sponsor[] = [
  { name: "ETHGlobal", href: "https://ethglobal.com", file: null, monochrome: true },
  { name: "ETHOnline 2026", href: "https://ethglobal.com/events/ethonline2026", file: null, monochrome: true },
  { name: "1inch", href: "https://1inch.io", file: null, monochrome: false },
  { name: "The Graph", href: "https://thegraph.com", file: null, monochrome: false },
  { name: "Chainlink", href: "https://chain.link", file: null, monochrome: false },
];
