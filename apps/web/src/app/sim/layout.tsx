import type { Metadata } from "next";

/**
 * What this route is, to everything that is not a browser running its clock.
 *
 * The replay is a client component and cannot export metadata itself, so the route's identity lives
 * here. Without it every share of this URL carried the landing's title and pointed its canonical at
 * the landing too — the strongest thing in the submission, described as something else.
 */
const TITLE = "Zentis replay — one position across three chains, as one screen";
const DESCRIPTION =
  "A recorded moment from three testnets, replayed: the shift the enclave published beside the one " +
  "the console recomputes from the same balances, both sides of the quote, the spread's four terms, " +
  "and what the position earned. Every figure is a real read, committed, not a simulation.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/sim" },
  openGraph: { type: "website", url: "/sim", siteName: "Zentis", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function SimLayout({ children }: { children: React.ReactNode }) {
  return children;
}
