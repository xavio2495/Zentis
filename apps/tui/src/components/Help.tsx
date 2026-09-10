import { Box, Text } from "ink";
import { type SimReport, headline } from "@zentis/console-data";
import { BINDINGS } from "../keymap.js";
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
  ["correction", TERM.correction, "the leg's curve drifted; the quote is put back on the mid"],
  ["concession", TERM.concession, "the leg pays to shed the token it holds too much of"],
  ["book", TERM.bookConcession, "the same concession charged across all three legs at once"],
  ["boundary", TERM.boundary, "how far a leg may concede; room is what is left of it"],
  ["base", TERM.base, "the half-spread the workflow is configured with"],
  ["volatility", TERM.volatility, "how much the leg's reference pool has moved lately"],
  ["markout", TERM.markout, "charged because recent fills went against the maker"],
  ["staleness", TERM.staleness, "the quote widens with the reference's age, to a cap"],
];

function simLines(report: SimReport, width: number): string[] {
  const regimes = report.regimes
    .map((r) => `${r.regime} ${r.seedsAhead}/${r.seeds} +${r.meanBpsOfBook.toFixed(1)}`)
    .join("  ");
  return [
    headline(report),
    // Basis points of the book, never the raw tokenA figure, which reads as dollars and is not.
    trunc(regimes, width),
    trunc(
      `mean and worst as bps of the ${report.bookInA / 1e6} tokenA opening book · ${report.signal}` +
        ` · own ${report.kappaBps} / book ${report.kappaBookBps} · model ${report.modelCommit.slice(0, 10)}`,
      width,
    ),
  ];
}

export function Help({
  report,
  actions,
  width,
  height,
}: {
  report: SimReport;
  actions: Action[];
  width: number;
  height: number;
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
      "instant on all of them, managing its inventory as a single book without bridging.",
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
    "The shift's split is recomputed here at the harness's published gains — own 10,000, book " +
      "5,000 — because the real ones never leave the enclave. A maker running other gains sees the " +
      "published shift diverge from this one, which is correct and is flagged on the leg.",
    width,
    6,
  ).entries()) {
    push(
      <Text key={`g${i}`} color={UI.muted}>
        {text}
      </Text>,
    );
  }
  for (const [i, text] of simLines(report, width).entries()) {
    push(
      <Text key={`s${i}`} color={i === 0 ? UI.heading : UI.muted}>
        {text}
      </Text>,
    );
  }
  for (const [i, text] of wrapLines(
    "The simulation ranks this policy against a static one over shared seeds. It is uncalibrated, " +
      "so it says which is ahead and not what either is worth.",
    width,
    4,
  ).entries()) {
    push(
      <Text key={`u${i}`} color={UI.muted}>
        {text}
      </Text>,
    );
  }

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
        "The console never reads the file; it hands the path to the commands it runs.",
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

  push(<Text key="sp1"> </Text>);
  push(
    <Text key="t2" color={UI.heading} bold>
      terms
    </Text>,
  );
  for (const [term, colour, meaning] of TERMS) {
    push(
      <Box key={term}>
        <Text color={colour}>{term.padEnd(12)}</Text>
        <Text color={UI.muted}>{trunc(meaning, width - 12)}</Text>
      </Box>,
    );
  }

  push(<Text key="sp2"> </Text>);
  push(
    <Text key="t3" color={UI.heading} bold>
      keys
    </Text>,
  );
  for (const binding of BINDINGS) {
    push(
      <Box key={binding.keys.join("")}>
        <Text color={UI.action}>{binding.keys.join(" / ").padEnd(12)}</Text>
        <Text color={UI.muted}>{trunc(binding.label, width - 12)}</Text>
      </Box>,
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {padRows(rows, height - 1, null).map((row, i) => (
        <Box key={i} height={1}>
          {row ?? <Text> </Text>}
        </Box>
      ))}
      <Text color={UI.muted}>{trunc("esc or ?  back", width)}</Text>
    </Box>
  );
}
