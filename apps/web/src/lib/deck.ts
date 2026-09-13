import { COPY, INSTALL_COMMAND, INTEGRATIONS, REPO_LABEL, ROUTES } from "./copy";

/**
 * The deck, as data.
 *
 * Presented live from a laptop to people who can open the repository while it is on screen, so
 * every sentence here traces to something already written down and reviewed: the claim and the
 * mechanism to `claude-docs/DIRECTION.md` sections one and two, and what is running to
 * `claude-docs/CAVEATS.md` section F. Nothing is composed for the slide.
 *
 * The landing's no-figure rule applies here too and is enforced by test. A slide is the worst
 * place to hand-type a number, because it is the one place a reader cannot click through to check
 * it — so the deck names what is true and lets the console and the replay carry the figures.
 */
export interface Slide {
  /** Addresses the slide from the URL, so a presenter can open on any one of them. */
  id: string;
  kicker: string;
  title: string;
  body: string;
  points?: readonly string[];
  /**
   * The places the argument is running, as doors. Only the close has them, and it takes them from
   * the same list the landing's close does, so the two pages cannot end on different invitations.
   */
  doors?: readonly { href: string; label: string; blurb: string }[];
}

export const SLIDES: readonly Slide[] = [
  {
    id: "claim",
    kicker: "The claim",
    title: "One mid. Three chains. No bridge.",
    body:
      "Zentis is one market-making position on several chains, quoting the same mid everywhere from one confidential policy, and managing its inventory as a single book without bridging.",
    points: [
      "Nothing crosses the chain boundary but a signed number.",
      "The legs are allowed to differ. Nothing has to move for the position to stay whole.",
    ],
  },
  {
    id: "problem",
    kicker: "The problem",
    title: "A position in several places drifts apart.",
    body:
      "A maker holding one position in several places has to decide what to do when the legs drift. The usual answer is to move inventory across a bridge, which costs time, fees, and the risk of being mid-transfer when the market turns.",
    points: [
      "Time: the transfer waits on an attestation before it can land.",
      "Fees: paid on both sides, every time the book is evened.",
      "Risk: while it is in flight the inventory is on neither leg.",
    ],
  },
  {
    id: "mechanism",
    kicker: "The mechanism",
    title: "A correction, then a bounded concession.",
    body:
      "One mainnet mid is published by a confidential workflow and written to every leg. Each leg's quote is then shifted off that mid by two numbers with different justifications, and a spread is drawn around the result.",
    points: [
      "The correction reprices the leg's own curve back onto the mid it drifted from.",
      "The concession is the leg paying to shed what it is long of, its own and a smaller one for the whole book.",
      "The concession is bounded by a budget priced off a real bridge quote, so a leg never gives away more than moving the inventory would have cost.",
      "The spread is a base, a term for volatility, and a markout term for how the reference moved after the last fills.",
    ],
  },
  {
    id: "integrations",
    kicker: "Built on",
    title: "Three integrations, each doing one job.",
    body: `Execution on ${INTEGRATIONS[0].name}, data through ${INTEGRATIONS[1].name}, compute inside ${INTEGRATIONS[2].name}.`,
    points: INTEGRATIONS.map((integration) => `${integration.name} — ${integration.claim}`),
  },
  {
    id: "live",
    kicker: "Running now",
    title: "It is up, and it can be checked.",
    body:
      "Every registry carries the identical mainnet mid, and both quote directions price on every leg. The reference is republished on a timer, and the volatility term is measured on the same real market the mid comes from, so it is the same number on each leg.",
    points: [
      `The console: ${ROUTES[0].blurb}.`,
      `The replay: ${ROUTES[1].blurb}.`,
      "The quote service turns every refusal the position can make into a sentence that says why.",
    ],
  },
  {
    id: "ask",
    kicker: "The ask",
    // The landing's own invitation, so the deck and the page end on the same words.
    title: COPY.tryItOut,
    body:
      "The position is live on three testnets, and the console that drives it installs in one line. Run it, or open the two places it is already running. Everything on the previous slides is written down in the repository, next to the thing it describes.",
    points: [INSTALL_COMMAND, REPO_LABEL],
    doors: ROUTES.filter((route) => route.atClose),
  },
];

/**
 * The prose the no-figure rule applies to.
 *
 * The install line and the repository are addresses rather than claims, and a sponsor's name is a
 * proper noun even when it opens with a numeral — the same three exemptions the landing makes, for
 * the same reasons.
 */
export function deckProse(): string[] {
  const addresses = new Set<string>([INSTALL_COMMAND, REPO_LABEL]);
  const names = INTEGRATIONS.map((integration) => integration.name);
  const strip = (line: string) => names.reduce((text, name) => text.split(name).join(""), line);
  return SLIDES.flatMap((slide) => [slide.kicker, slide.title, slide.body, ...(slide.points ?? [])])
    .filter((line) => !addresses.has(line))
    .map(strip);
}

/**
 * The whole deck as plain text, for the `<noscript>`.
 *
 * Not a summary. A deck that exists only as animation cannot be linked, read by a crawler, or
 * opened by someone whose laptop is having a bad morning ten minutes before a demo — and this one
 * is the argument, so it has to survive all three.
 */
export const DECK_NOSCRIPT: string = SLIDES.map((slide) =>
  [
    `${slide.kicker}: ${slide.title}`,
    slide.body,
    ...(slide.points ?? []).map((p) => `— ${p}`),
    ...(slide.doors ?? []).map((door) => `— ${door.label}: ${door.blurb}`),
  ].join(" "),
).join("\n\n");

export const DECK_META = {
  title: "Zentis — the deck",
  description:
    "Six slides: one market-making position quoting the same mainnet mid on three chains from one confidential policy, what it is built on, and what is running.",
} as const;

const FORWARD = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"]);
const BACK = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);

/**
 * Where a key press lands, as a pure function of where the deck already is.
 *
 * Pure so the presenter's keyboard can be tested without a browser, which is the half of this page
 * that has to work: a slide that animates wrongly is survivable in front of an audience, and a
 * right arrow that does nothing is not.
 *
 * It clamps rather than wraps. Wrapping past the last slide puts the opening claim back on screen
 * at the exact moment the presenter meant to stop and answer a question.
 */
export function nextIndex(current: number, key: string, count: number): number {
  const last = count - 1;
  const clamp = (index: number) => (index < 0 ? 0 : index > last ? last : index);
  if (key === "Home") return 0;
  if (key === "End") return last;
  if (FORWARD.has(key)) return clamp(current + 1);
  if (BACK.has(key)) return clamp(current - 1);
  return current;
}
