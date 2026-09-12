/**
 * Every word the landing says, in one place.
 *
 * Two rules are enforced by test rather than remembered. The prose carries no
 * figure at all, because every number this project shows has to trace to a
 * committed simulation run or a real fill. And each integration is described
 * only as the project itself defines it, with no claim beyond that.
 */

export const INSTALL_COMMAND = "curl -fsSL https://zentis-eth.vercel.app/install.sh | bash";

/** The repository the install line pulls its release from. */
export const REPO_URL = "https://github.com/xavio2495/Zentis";
export const REPO_LABEL = "github.com/xavio2495/Zentis";

export interface Integration {
  name: string;
  role: string;
  claim: string;
}

export const INTEGRATIONS: Integration[] = [
  {
    name: "1inch",
    role: "execution",
    claim:
      "Custom SwapVM instructions running on the official, unmodified Aqua and SwapVM contracts.",
  },
  {
    name: "The Graph",
    role: "data",
    claim:
      "A standardized Aqua position schema, and a fills subgraph on each of the three testnets.",
  },
  {
    name: "Chainlink",
    role: "compute",
    claim:
      "A confidential workflow that computes the tilt inside a TEE and writes the reference registry.",
  },
];

/** The three words the loader crosses through while the field is built. */
export const LOADER_WORDS = ["Quote", "Tilt", "Fill"] as const;

/**
 * The two places the argument is demonstrated rather than made.
 *
 * Declared once so the nav, the contact section and each route's own header all name the same
 * paths — three components inventing "/sim" separately is three chances to be wrong about it, and
 * a dead link on a judged submission costs more than a typo usually does.
 */
export const ROUTES = [
  {
    href: "/console",
    label: "Console",
    blurb: "the tool the maker runs, on the recorded moment",
  },
  {
    href: "/sim",
    label: "Replay",
    blurb: "the same moment as one screen, for a reader in forty seconds",
  },
] as const;

export const COPY = {
  wordmark: "ZENTIS",
  heroLine: "Market making · Three chains · One position",
  tagline: "Price the imbalance. Don't bridge it.",

  statement: "One mid. Three chains. No bridge.",
  statementBody:
    "A market maker holds one position and quotes it in several places at once. When the legs drift apart, the usual answer is to move inventory across a bridge and pay for the privilege in time, in fees and in risk. Zentis answers with price instead: every leg quotes the same mid, the quote tilts toward the leg that is short, and the imbalance becomes worth something to close. Nothing crosses.",

  integrationsLabel: "Built on",
  installLabel: "Install the console",
  installHint: "Click to copy",
  installCopied: "Copied",

  contactLine: "Read it for yourself.",
  tryItOut: "Try it out.",
  contactHint: "Click to copy",
  contactCopied: "Copied",

  outro: "Three legs. One book. Nothing in transit.",
  footer: "Zentis · Aqua · SwapVM",

  noscript:
    "Zentis is a market maker that runs a single Aqua position across several chains and rebalances by pricing rather than by bridging. When the legs drift apart, the quote tilts toward the leg that is short instead of moving inventory across a bridge. This page is an animated introduction; enable JavaScript for it, or install the console with the command below.",
} as const;

/**
 * The prose the no-figure rule applies to. The install line and the repository
 * are addresses rather than claims, and a sponsor's name is a proper noun even
 * when it opens with a numeral, so none of them is prose.
 */
export function prose(): string[] {
  return [...Object.values(COPY), ...LOADER_WORDS, ...INTEGRATIONS.flatMap((i) => [i.role, i.claim])];
}
