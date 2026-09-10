import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { type LegSnapshot, humanDuration } from "@zentis/console-data";
import { chooseFit, duration, signed, tokenAmount } from "../format.js";
import { plot } from "../chart.js";
import { Panel, panelInner } from "./Panel.js";
import { type Seg, fitSegments, padRows, trunc } from "../layout.js";
import { Segments } from "./Segments.js";
import { STATE, UI, legColour } from "../theme.js";

/**
 * One leg, reduced to what a glance needs.
 *
 * Everything that explains rather than reports — the decomposition, the spread's four names, room
 * and boundary, the why line — moved to the detail view behind `1`/`2`/`3`. What is left is the
 * five facts an operator watches: which chain and whether it is live, what it would pay right now,
 * what it holds, how far off the mid it is quoting, and how wide.
 */
export function legState(leg: LegSnapshot): { word: string; short: string; tone: string } {
  // A read that failed is not a position that is absent. Both arrive as a null `position`, and
  // reporting the first as the second told a viewer, during a rate-limit outage, that the position
  // this whole console is about had gone away.
  if (leg.sources.fills !== null) {
    return { word: `unavailable — ${leg.sources.fills}`, short: "unread", tone: STATE.refusing };
  }
  if (leg.position === null) return { word: "no position", short: "none", tone: STATE.docked };
  if (!leg.position.active) return { word: "docked", short: "docked", tone: STATE.docked };
  if (leg.spread?.tooStaleToQuote === true) {
    const age = humanDuration(leg.spread.referenceAgeSeconds);
    return { word: `stale ${age}`, short: `stale ${age}`, tone: STATE.refusing };
  }
  if (leg.ref === null) return { word: "no reference", short: "no ref", tone: STATE.refusing };
  return { word: "live", short: "live", tone: STATE.live };
}

/** The quote, or the single reason there is not one. */
function quoteLine(leg: LegSnapshot, width: number): { text: string; tone: string } {
  const quote = leg.quoteAToB;
  if (quote?.amountOut == null) {
    const reason =
      leg.sources.fills !== null
        ? "this leg could not be read"
        : leg.spread?.tooStaleToQuote === true
          ? "reference too stale"
          : "not priced";
    return { text: trunc(`quote — ${reason}`, width), tone: UI.muted };
  }
  const inAmount = `${tokenAmount(quote.amountIn, leg.config.tokenA.decimals)} ${leg.config.tokenA.symbol}`;
  const outAmount = `${tokenAmount(quote.amountOut, leg.config.tokenB.decimals)} ${leg.config.tokenB.symbol}`;
  return {
    text: chooseFit([`${inAmount} → ${outAmount}`, `→ ${outAmount}`, outAmount], width),
    tone: UI.heading,
  };
}

export function LegCard({
  leg,
  index,
  width,
  height,
  selected,
  windowSeconds,
}: {
  leg: LegSnapshot;
  index: number;
  width: number;
  height: number;
  selected: boolean;
  windowSeconds: bigint;
}) {
  const colour = legColour(leg.config.chainId);
  const state = legState(leg);
  const { width: inner, height: innerRows } = panelInner(width, height);
  const quote = quoteLine(leg, inner);
  const shift = leg.shift;
  const position = leg.position;

  const rows: ReactNode[] = [];

  // What this chain holds, in the tokens it holds them in. The first question anyone asks of a leg.
  rows.push(
    position === null ? (
      // The panel's title already says `unread`, and the status bar carries the reason in full;
      // repeating a truncated copy of it here spends the card's widest line on nothing.
      <Text color={UI.muted}>{trunc(leg.sources.fills === null ? "no position" : "could not be read", inner)}</Text>
    ) : (
      <Segments
        segs={fitSegments(
          [
            [
              { text: "holds ", color: UI.muted },
              {
                text: `${tokenAmount(position.balanceA, leg.config.tokenA.decimals)} ${leg.config.tokenA.symbol}`,
                color: UI.heading,
              },
              { text: " · ", color: UI.muted },
              {
                text: `${tokenAmount(position.balanceB, leg.config.tokenB.decimals)} ${leg.config.tokenB.symbol}`,
                color: UI.heading,
              },
            ],
            [
              { text: "holds ", color: UI.muted },
              {
                text: `${tokenAmount(position.balanceA, leg.config.tokenA.decimals)} / ${tokenAmount(position.balanceB, leg.config.tokenB.decimals)}`,
                color: UI.heading,
              },
            ],
          ],
          inner,
        )}
      />
    ),
  );

  rows.push(<Text color={quote.tone}>{quote.text}</Text>);

  if (shift !== null) {
    rows.push(
      <Segments
        segs={fitSegments(
          [
            [
              { text: "shift ", color: UI.muted },
              { text: signed(shift.tiltBps).padEnd(6), color: UI.heading },
              { text: "spread ", color: UI.muted },
              { text: `${leg.spread?.totalBps ?? 0}`, color: UI.heading },
            ],
            [
              { text: "shift ", color: UI.muted },
              { text: signed(shift.tiltBps), color: UI.heading },
            ],
          ],
          inner,
        )}
      />,
    );
  }

  // The leg's own price line, small. The card answers "is this chain moving?" at a glance; the
  // detail view behind its number answers why.
  const sparkRows = Math.max(0, innerRows - rows.length - 1);
  if (sparkRows > 0 && leg.series !== null) {
    const p = plot([{ key: "s", samples: leg.series.samples }], inner, sparkRows, windowSeconds)
      .byKey.get("s")!;
    for (const row of p.rows) rows.push(<Text color={colour}>{row}</Text>);
    rows.push(
      <Text color={UI.muted}>
        {trunc(`×${p.minRatio.toFixed(2)}–×${p.maxRatio.toFixed(2)} over ${duration(Number((p.to ?? 0n) - (p.from ?? 0n)))}`, inner)}
      </Text>,
    );
  } else if (sparkRows > 0 && leg.sources.pool !== null) {
    rows.push(<Text color={UI.caveat}>{trunc(`price history: ${leg.sources.pool}`, inner)}</Text>);
  }

  return (
    <Panel
      title={`${index + 1} ${leg.config.label.split(" ")[0]}`}
      right={state.short}
      width={width}
      height={height}
      colour={selected ? colour : UI.frame}
    >
      <Box flexDirection="column" width={inner} height={innerRows} overflow="hidden">
        {padRows(rows, innerRows, null).map((row, i) => (
          <Box key={i} height={1}>
            {row ?? <Text> </Text>}
          </Box>
        ))}
      </Box>
    </Panel>
  );
}
