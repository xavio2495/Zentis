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
    href: "/deck",
    label: "Deck",
    blurb: "the argument as six slides, for a room",
    // The close asks the reader to try the thing. A deck is for a room with a presenter in it, so
    // it belongs in the nav and not among the two doors at the foot of the page.
    atClose: false,
  },
  {
    href: "/console",
    label: "Console",
    blurb: "the tool the maker runs, on the recorded moment",
    atClose: true,
  },
  {
    href: "/sim",
    label: "Replay",
    blurb: "the same moment as one screen, for a reader in forty seconds",
    atClose: true,
  },
] as const;

export const COPY = {
  wordmark: "ZENTIS",
  heroLine: "Market making · Three chains · One book",
  tagline: "One mid everywhere. No bridge anywhere.",

  statement: "One position. Three legs. One book.",
  statementLead:
    "One position, quoted in three places from one mainnet reference, with the inventory carried as a single book. The legs are allowed to differ; nothing has to move for the position to stay whole.",
  statementBody:
    "A market maker holding one position in several places has to decide what to do when the legs drift apart. The usual answer is to move inventory across a bridge, which costs time, fees and the risk of being mid-transfer when the market turns. Zentis does not move it. Every leg quotes the same mid — one mainnet reference, published from one confidential policy, and the inventory is carried as a single book — so the legs are allowed to differ, and nothing has to move for the position to stay whole.",

  mechanismLabel: "The quote",
  mechanismLead:
    "A correction back onto the mid, then a concession for what the leg is long of — bounded by what moving the inventory would have cost.",
  mechanismBody:
    "Each leg's quote is tilted off the mid by two kinds of number. First a correction, which puts the leg's own curve back on the mid it drifted from. Then a concession, which is the leg paying to shed what it is long of — its own, and a smaller one for the book as a whole. The concession is bounded by a budget priced off a real bridge quote, so the most a leg will ever give away is what moving the inventory would have cost. Around that sits a spread: a base, a term for volatility, and a markout term for how the reference moved after the last fills were taken.",

  dialLabel: "What the cross-chain term buys",
  dialLead:
    "The book-wide term is a dial on risk, not a source of profit. The edge is earned leg by leg; what the shared reference adds is the mid, and a way to lean the whole book at once.",
  dialBody:
    "The book-wide concession is a dial on risk, not a source of profit. The edge a maker earns is earned leg by leg; what the shared reference adds is the mid every leg anchors to, and a way to lean the whole book the same direction when it is lopsided. How often that reference is published matters more to the outcome than any other choice in the system.",

  integrationsLabel: "Built on",
  installLabel: "Install the console",
  installHint: "Click to copy",
  installCopied: "Copied",

  contactLine: "Read it for yourself.",
  tryItOut: "Try it out.",
  contactHint: "Click to copy",
  contactCopied: "Copied",

  footer: "Zentis · Aqua · SwapVM",

  metaTitle: "Zentis — one position, three chains, no bridge",
  metaDescription:
    "One market-making position quoting the same mainnet mid on three chains from one confidential policy, carrying its inventory as a single book without bridging.",

  noscript:
    "Zentis runs one market-making position across three chains. Every leg quotes the same mainnet mid, published from a confidential workflow, and the inventory is carried as one book rather than moved between chains. Each leg's quote is a correction back onto the mid plus a bounded concession for the inventory it holds. This page is an animated introduction; enable JavaScript for it, or install the console with the command below.",
} as const;

/**
 * The prose the no-figure rule applies to. The install line and the repository
 * are addresses rather than claims, and a sponsor's name is a proper noun even
 * when it opens with a numeral, so none of them is prose.
 */
export function prose(): string[] {
  return [...Object.values(COPY), ...LOADER_WORDS, ...INTEGRATIONS.flatMap((i) => [i.role, i.claim])];
}
