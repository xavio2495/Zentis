import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { BACKFILLING, BOOK, type LegSnapshot, humanDuration, offMidBps, weightPercent } from "@zentis/console-data";
import { chooseFit, duration, pairPrice, signed, stackedGauge, tokenAmount, weightBar } from "../format.js";
import { plot } from "../chart.js";
import { quoted } from "../quoted.js";
import { Panel, panelInner } from "./Panel.js";
import { type Seg, fitSegments, padRows, trunc } from "../layout.js";
import { Segments } from "./Segments.js";
import { STATE, TERM, UI, legColour } from "../theme.js";

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

/**
 * One side of the quote, with how far it sits from the mid.
 *
 * Both sides are shown because one alone hides two things: the spread (the gap between them) and the
 * shift's direction (which side is dearer). The distance is against the reference's own mid, so a
 * leg quoting at its cap reads as a large number here rather than as an ordinary price.
 */
function side(leg: LegSnapshot, isAToB: boolean, width: number): Seg[] | null {
  const quote = isAToB ? leg.quoteAToB : leg.quoteBToA;
  const [from, to] = isAToB ? [leg.config.tokenA, leg.config.tokenB] : [leg.config.tokenB, leg.config.tokenA];
  if (quote === null) return null;
  if (quote.amountOut === null) {
    // A side the router refuses is a fact about the leg, and leaving the row out said nothing had
    // been asked. Live, Sepolia's router answered USDC → WETH and reverted WETH → USDC.
    const refused = quote.caveats.some((c) => c.includes("refused"));
    return fitSegments(
      [
        [
          { text: `${from.symbol} → ${to.symbol}  `, color: UI.muted },
          { text: refused ? "refused by the router" : "not priced", color: UI.caveat },
        ],
        [{ text: `${from.symbol} → ${to.symbol} ${refused ? "refused" : "unpriced"}`, color: UI.caveat }],
      ],
      width,
    );
  }
  const inText = `${tokenAmount(quote.amountIn, from.decimals)} ${from.symbol}`;
  const outText = `${tokenAmount(quote.amountOut, to.decimals)} ${to.symbol}`;
  const off = offMidBps(quote, isAToB);
  const away = off === null ? "" : `  ${signed(off)} bps`;
  return fitSegments(
    [
      [
        { text: `${inText} → ${outText}`, color: UI.heading },
        { text: away, color: UI.muted },
      ],
      [{ text: `${inText} → ${outText}`, color: UI.heading }],
      [
        { text: `→ ${outText}`, color: UI.heading },
        { text: away, color: UI.muted },
      ],
      [{ text: `→ ${outText}`, color: UI.heading }],
    ],
    width,
  );
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
  const { shift, position, spread } = leg;

  // The rows in the order a short card gives them up: the numbers first, the picture last. The
  // sparkline is the card's least essential row because the chart beside it draws the same line
  // larger.
  const rows: ReactNode[] = [];

  if (leg.sources.fills !== null) {
    // Once, and saying what *was* read: the pool price comes over RPC and is fine, and a card that
    // only said "could not be read" above a working price line contradicted itself.
    rows.push(
      <Text color={UI.caveat}>
        {chooseFit(
          [
            `position unread (${leg.sources.fills.replace(/^subgraph /, "")})`,
            "position unread",
          ],
          inner,
        )}
      </Text>,
    );
    if (leg.series !== null) rows.push(<Text color={UI.muted}>{trunc("pool price from RPC", inner)}</Text>);
  } else if (position === null) {
    rows.push(<Text color={UI.muted}>{trunc("no position on this chain", inner)}</Text>);
  } else {
    rows.push(
      <Segments
        segs={fitSegments(
          [
            [
              { text: "holds ", color: UI.muted },
              {
                text:
                  `${tokenAmount(position.balanceA, leg.config.tokenA.decimals)} ${leg.config.tokenA.symbol}` +
                  ` · ${tokenAmount(position.balanceB, leg.config.tokenB.decimals)} ${leg.config.tokenB.symbol}`,
                color: UI.heading,
              },
            ],
            [
              {
                text: `${tokenAmount(position.balanceA, leg.config.tokenA.decimals)} / ${tokenAmount(position.balanceB, leg.config.tokenB.decimals)}`,
                color: UI.heading,
              },
            ],
          ],
          inner,
        )}
      />,
    );
    if (shift !== null) {
      // The split in percent beside the bar, the even point marked, so "how lopsided is this leg" is
      // a glance rather than arithmetic on two balances in different tokens.
      const pct = `${weightPercent(shift.weightA)}% ${leg.config.tokenA.symbol}`;
      rows.push(
        <Segments
          segs={[
            { text: "▕", color: UI.frame },
            { text: weightBar(shift.weightA, Math.max(6, inner - pct.length - 3)), color: colour },
            { text: "▏", color: UI.frame },
            { text: ` ${pct}`, color: UI.muted },
          ]}
        />,
      );
    }
  }

  for (const isAToB of [true, false]) {
    const segs = side(leg, isAToB, inner);
    if (segs !== null) rows.push(<Segments segs={segs} />);
  }
  if (leg.sources.fills === null && leg.quoteAToB?.amountOut == null && position !== null) {
    const reason = spread?.tooStaleToQuote === true ? "reference too stale to quote" : "not priced";
    rows.push(<Text color={UI.muted}>{trunc(`quote — ${reason}`, inner)}</Text>);
  }

  if (shift === null && leg.ref !== null) {
    // The decomposition is withheld when any leg is unread — it reads every leg — but the shift the
    // enclave published comes from the registry over RPC and is known. Saying it, and saying it is
    // the published number rather than one recomputed here, keeps the product's own figure on the
    // card in exactly the state where a viewer most wants it.
    const cap = position?.maxTiltBps ?? BOOK.maxTiltBps;
    const atCap = Math.abs(leg.ref.tiltBps) >= cap ? " at cap" : "";
    rows.push(
      <Text color={UI.heading}>
        {chooseFit(
          [`shift ${signed(leg.ref.tiltBps)}${atCap} · published`, `shift ${signed(leg.ref.tiltBps)}${atCap}`],
          inner,
        )}
      </Text>,
    );
  }

  if (shift !== null) {
    // One signed number with a small centred gauge. "at cap" is said, because −500 on a leg whose
    // cap is 500 is not a size, it is a limit.
    const atCap = shift.clampedByMaxTilt ? " at cap" : "";
    const label = `shift ${signed(shift.tiltBps)}${atCap}`;
    const tail = spread === null ? "" : `  spread ${spread.totalBps}`;
    const gaugeWidth = Math.max(0, Math.min(12, inner - label.length - tail.length - 2));
    const gauge =
      gaugeWidth >= 6
        ? stackedGauge(shift.correction, shift.concession, BigInt(position?.maxTiltBps ?? 500), gaugeWidth)
        : [];
    rows.push(
      <Segments
        segs={fitSegments(
          [
            [
              { text: `${label} `, color: UI.heading },
              ...gauge.map((span) => ({
                text: span.text,
                color:
                  span.term === "correction" ? TERM.correction : span.term === "concession" ? TERM.concession : UI.frame,
              })),
              { text: tail, color: UI.muted },
            ],
            [
              { text: label, color: UI.heading },
              { text: tail, color: UI.muted },
            ],
            [{ text: label, color: UI.heading }],
          ],
          inner,
        )}
      />,
    );
  }

  // The price, labelled with the window it is drawn over, and then the line itself in whatever rows
  // are left — three or four at most. Everything the card has to say comes first.
  if (leg.series !== null) {
    const price = pairPrice(leg.series.mid, leg.config.tokenA, leg.config.tokenB);
    const over = duration(Number(windowSeconds));
    const lineRows = Math.min(4, innerRows - rows.length - 1);
    if (lineRows >= 2) {
      // As quoted, like the chart: the line rises when the price on the row below it rises.
      const p = plot([{ key: "s", samples: quoted(leg.series.samples) }], inner, lineRows, windowSeconds).byKey.get("s")!;
      for (const row of p.rows) rows.push(<Text color={colour}>{row}</Text>);
    }
    rows.push(<Text color={UI.muted}>{chooseFit([`${price} · ${over} window`, price], inner)}</Text>);
  } else if (leg.sources.pool !== null) {
    const reading = leg.sources.pool === BACKFILLING;
    rows.push(
      <Text color={reading ? UI.muted : UI.caveat}>{trunc(`pool price: ${leg.sources.pool}`, inner)}</Text>,
    );
  }

  return (
    <Panel
      title={`${index + 1} ${leg.config.label}`}
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
