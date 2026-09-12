import { Box, Text } from "ink";
import type { Action } from "../action-types.js";
import { padRows, trunc, wrapLines } from "../layout.js";
import { TERM, UI } from "../theme.js";

/**
 * The one place prose lives.
 *
 * Ordered so that what clips is what can be spared. The region is whatever the terminal leaves, and
 * content past it is dropped from the bottom — so the disclosures come first and the terms and keys
 * tables last, because a reader can work out what `spread` means by looking at the screen and cannot
 * work out that the gains were assumed.
 *
 * Every honest disclosure the console owes a reader is here rather than on the main screen: what the
 * terms mean, that the decomposition assumes gains it cannot read out of the enclave, what the
 * simulation does and does not claim. On the main screen these were footnotes competing with the
 * numbers and losing; a reader who wants them presses `?`, and a reader watching the book is not
 * asked to read them every second.
 *
 * The key table is generated from the bindings rather than written, so it cannot drift from what the
 * keys actually do.
 */
const TERMS: [string, string, string][] = [
  ["shift", TERM.correction, "how far off the mid a leg quotes; one signed number on-chain"],
  ["venue", UI.muted, "where a leg's trades settle; the book's price comes from the mainnet mark"],
  ["correction", TERM.correction, "the leg's curve drifted; the quote is put back on the mid"],
  ["concession", TERM.concession, "the leg pays to shed the token it holds too much of"],
  ["book", TERM.bookConcession, "the same concession charged across all three legs at once"],
  ["boundary", TERM.boundary, "how far a leg may concede; room is what is left of it"],
  ["base", TERM.base, "the half-spread the workflow is configured with"],
  ["volatility", TERM.volatility, "how much the leg's reference pool has moved lately"],
  ["markout", TERM.markout, "charged because recent fills went against the maker"],
  ["staleness", TERM.staleness, "the quote widens with the reference's age, to a cap"],
];

/**
 * What each page would otherwise have to say on itself, every frame, in rows it needs for numbers.
 */
const PAGES: [string, string][] = [
  [
    "positions",
    "What each leg was shipped as, what it holds, and what that is worth at the mainnet mark rather " +
      "than at its own venue. The panel below sizes a top-up from the leg's own reserves.",
  ],
  [
    "pnl",
    "Marked at the mainnet spot price. Trading is the fills' arithmetic; hold is what the inventory " +
      "the leg was shipped with is worth now against the mark it was shipped against — so tokens " +
      "pushed to a leg after it shipped are not in it, and the book's hold understates by their move.",
  ],
  [
    "wallet",
    "Aqua holds no tokens: it records the committed balance and pulls from this wallet at settlement. " +
      "Committed is a claim on held; an approval below it reverts the next fill.",
  ],
  [
    "simulation",
    "Ranks this policy against a static one over shared seeds; it is uncalibrated, so it says which " +
      "is ahead and not what either is worth. Mean and worst are basis points of the opening book.",
  ],
  [
    "log",
    "What this console did, where the feed usually is: what was asked for, and what went on chain " +
      "because of it. The feed is the book's side of the same story, and `l` swaps between them.",
  ],
  [
    "status",
    "Every source the console reads: whether it is answering, serving its last good value or down, " +
      "what it last said, how often it is asked, and what is left of its allowance.",
  ],
  [
    "leg detail",
    "The shift is one signed number on-chain, rebuilt as its correction and its concessions. A venue " +
      "is where a leg's trades settle, not what it quotes from.",
  ],
];

export function Help({
  actions,
  width,
  height,
  offset = 0,
}: {
  actions: Action[];
  width: number;
  height: number;
  /** how far the page has been scrolled, in rows; `↑`/`↓` move it */
  offset?: number;
}) {
  const rows: React.ReactNode[] = [];
  const push = (node: React.ReactNode) => rows.push(node);

  push(
    <Text key="t1" color={UI.heading} bold>
      what this is
    </Text>,
  );
  // Wrapped to as many rows as the sentence needs rather than a fixed three: this column is the one
  // place prose lives, and a paragraph clipped mid-clause at 80 columns is the thing being fixed.
  for (const [i, text] of wrapLines(
    "One market-making position on three chains, quoting from one reference published at the same " +
      "instant on all of them, managed as a single book without bridging.",
    width,
    6,
  ).entries()) {
    push(
      <Text key={`w${i}`} color={UI.muted}>
        {text}
      </Text>,
    );
  }

  push(<Text key="sp3"> </Text>);
  push(
    <Text key="t4" color={UI.heading} bold>
      what the numbers are, and are not
    </Text>,
  );
  for (const [i, text] of wrapLines(
    "The shift's split is recomputed here at the published gains — own 10,000, book 5,000 — because " +
      "the real ones never leave the enclave, so a maker running others sees it diverge.",
    width,
    6,
  ).entries()) {
    push(
      <Text key={`g${i}`} color={UI.muted}>
        {text}
      </Text>,
    );
  }
  // The run itself is a page of its own on `m`, and what it claims is under "simulation" below; it
  // used to be repeated here, which cost this page five rows and clipped the sections beneath it.

  // How to arm the console, here rather than in the status bar: it is not a warning to someone who
  // only wants to watch, and someone who wants to act will look here.
  const off = actions.filter((a) => a.disabledReason !== null);
  if (off.length > 0) {
    push(<Text key="sp0"> </Text>);
    push(
      <Text key="t0" color={UI.heading} bold>
        acting, not just watching
      </Text>,
    );
    for (const [i, text] of wrapLines(
      `${off.map((a) => a.key).join(", ")} are off: ${off[0]!.disabledReason}. ` +
        "The console never reads that file; it hands its path to the commands it runs.",
      width,
      4,
    ).entries()) {
      push(
        <Text key={`a${i}`} color={UI.muted}>
          {text}
        </Text>,
      );
    }
  }

  // One heading per page, carrying what that page used to say in prose. The pages show data; this is
  // where a reader who wants the sentence behind a column finds it, once, instead of on every frame.
  push(<Text key="sppg"> </Text>);
  push(
    <Text key="tpg" color={UI.heading} bold>
      the pages
    </Text>,
  );
  for (const [page, prose] of PAGES) {
    for (const [i, text] of wrapLines(prose, width - 12, 6).entries()) {
      push(
        <Box key={`pg${page}${i}`}>
          <Text color={UI.action}>{(i === 0 ? page : "").padEnd(12)}</Text>
          <Text color={UI.muted}>{text}</Text>
        </Box>,
      );
    }
  }

  push(<Text key="sp1"> </Text>);
  push(
    <Text key="t2" color={UI.heading} bold>
      terms
    </Text>,
  );
  for (const [term, colour, meaning] of TERMS) {
    // Wrapped under its own term, never cut: a definition that stops mid-clause defines nothing.
    for (const [i, text] of wrapLines(meaning, width - 12, 2).entries()) {
      push(
        <Box key={`${term}${i}`}>
          <Text color={colour}>{(i === 0 ? term : "").padEnd(12)}</Text>
          <Text color={UI.muted}>{text}</Text>
        </Box>,
      );
    }
  }

  // No key table here any more: the keys have their own section on screen at all times now, and a
  // second copy of them was the longest thing on the page a reader already had in front of them.

  // Scrolled rather than trimmed. This page explains five others, and at a hundred and twenty
  // columns that is more rows than the region has; cutting the explanation until it fitted would be
  // cutting the thing a reader opened it for. The last row says where they are in it.
  const body = Math.max(1, height - 1);
  const top = Math.max(0, Math.min(offset, Math.max(0, rows.length - body)));
  const shown = rows.slice(top, top + body);
  const more = rows.length - (top + body);
  const footer =
    more > 0
      ? `esc or ?  back    ↓ ${more} more`
      : top > 0
        ? "esc or ?  back    ↑ back up"
        : "esc or ?  back";

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {padRows(shown, body, null).map((row, i) => (
        <Box key={i} height={1}>
          {row ?? <Text> </Text>}
        </Box>
      ))}
      <Text color={UI.muted}>{trunc(footer, width)}</Text>
    </Box>
  );
}
