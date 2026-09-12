import type { Metadata } from "next";

/**
 * What this route is, to everything that is not a browser with scripts on.
 *
 * The page itself is a client component — it mounts a terminal — and a client component cannot
 * export metadata, so the route's identity lives here. Without it the console inherited the
 * landing's title and description, which meant every share of this URL described the pitch rather
 * than the tool, and the canonical pointed somewhere else entirely.
 */
const TITLE = "Zentis console — the operator's screen, on a recorded moment";
const DESCRIPTION =
  "The console the maker runs, in a browser: three chains as one position, the shift the enclave " +
  "published beside the one recomputed from the same balances, and every key the terminal offers. " +
  "It reads nothing — the moment is a committed recording of the three testnets.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/console" },
  openGraph: { type: "website", url: "/console", siteName: "Zentis", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
