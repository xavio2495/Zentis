import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { BACKFILLING, BOOK, type LegSnapshot, type LegStateKind, type Snapshot, legState as legStateOf, offMidBps, weightPercent } from "@zentis/console-data";
import { chooseFit, duration, pairPrice, signed, stackedGauge, tokenAmount, weightBar } from "../format.js";
import { plot } from "../chart.js";
import { plotSigned, shiftSeries } from "../shift-line.js";
import { quoted } from "../quoted.js";
import { Panel, panelInner } from "./Panel.js";
import { spinnerAt } from "../spinner.js";
import { type Seg, fitSegments, fitTogether, padRows, trunc } from "../layout.js";
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
/** What each state looks like. Which state a leg is in is the data layer's; the colour is ours. */
const TONES: Record<LegStateKind, string> = {
  unread: STATE.refusing,
  none: STATE.docked,
  docked: STATE.docked,
  stale: STATE.refusing,
  unpriced: STATE.refusing,
  live: STATE.live,
};

export function legState(leg: LegSnapshot): { word: string; short: string; tone: string } {
  const state = legStateOf(leg);
  return { word: state.word, short: state.short, tone: TONES[state.kind] };
}

/**
 * One side of the quote, with how far it sits from the mid.
 *
 * Both sides are shown because one alone hides two things: the spread (the gap between them) and the
 * shift's direction (which side is dearer). The distance is against the reference's own mid, so a
 * leg quoting at its cap reads as a large number here rather than as an ordinary price.
 */
/**
 * The card's name for each refusal the quote service decodes, keyed off the contract's error name
 * because that is stable and the service's sentence is not. An error not listed here still reads as
 * "refused by the router", with its sentence in the detail.
 */
const REFUSAL_NAMES: Record<string, string> = {
  ZentisOutsideBand: "outside the band",
  ZentisReferenceStale: "reference too old",
  ZentisSeqMismatch: "seq moved",
};

function sideVariants(leg: LegSnapshot, isAToB: boolean): Seg[][] | null {
  const quote = isAToB ? leg.quoteAToB : leg.quoteBToA;
  const [from, to] = isAToB ? [leg.config.tokenA, leg.config.tokenB] : [leg.config.tokenB, leg.config.tokenA];
  if (quote === null) return null;
  if (quote.amountOut === null) {
    // A side the router refuses is a fact about the leg, and leaving the row out said nothing had
    // been asked. The card has room for the reason's name, keyed off the contract's error; the
    // service's whole sentence is in the leg's detail.
    const refused = quote.refusal !== null || quote.caveats.some((c) => c.includes("refused"));
    const reason = quote.refusal === null ? null : (REFUSAL_NAMES[quote.refusal.error] ?? null);
    const pair = `${from.symbol} → ${to.symbol}`;
    return [
        ...(reason === null
          ? []
          : [
              [
                { text: `${pair}  `, color: UI.muted },
                { text: `refused: ${reason}`, color: UI.caveat },
              ],
              [
                { text: `${pair} `, color: UI.muted },
                { text: `refused, ${reason}`, color: UI.caveat },
              ],
            ]),
        [
          { text: `${pair}  `, color: UI.muted },
          { text: refused ? "refused by the router" : "not priced", color: UI.caveat },
        ],
      [{ text: `${pair} ${refused ? "refused" : "unpriced"}`, color: UI.caveat }],
    ];
  }
  const inText = `${tokenAmount(quote.amountIn, from.decimals)} ${from.symbol}`;
  const outText = `${tokenAmount(quote.amountOut, to.decimals)} ${to.symbol}`;
  const off = offMidBps(quote, isAToB);
  const away = off === null ? "" : `  ${signed(off)} bps`;
  // A tighter spelling before the distance is dropped altogether. The two sides differ by a couple
  // of characters, and at a third of a 120-column terminal the longer one missed by exactly one, so
  // without this step the pair loses the number that says how far off the mid the quote really is.
  const tight = off === null ? "" : ` ${signed(off)} bps`;
  return [
    [
      { text: `${inText} → ${outText}`, color: UI.heading },
      { text: away, color: UI.muted },
    ],
    [
      { text: `${inText} → ${outText}`, color: UI.heading },
      { text: tight, color: UI.muted },
    ],
    [{ text: `${inText} → ${outText}`, color: UI.heading }],
    [
      { text: `→ ${outText}`, color: UI.heading },
      { text: tight, color: UI.muted },
    ],
    [{ text: `→ ${outText}`, color: UI.heading }],
  ];
}

export function LegCard({
  leg,
  snapshot,
  index,
  width,
  height,
  selected,
  windowSeconds,
}: {
  leg: LegSnapshot;
  /** the whole snapshot, because a leg's shift history lives in the feed rather than on the leg */
  snapshot: Snapshot;
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
        {/* The source, not its excuse: what the endpoint said is one line in the panel above. */}
        {chooseFit([`${spinnerAt(Date.now())} waiting on fills`, "position unread"], inner)}
      </Text>,
    );
    // Nothing about the venue here: it is where this leg's trades settle, not what the book prices
    // from, and on an unread card it named a source the reader has no use for.
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

  // Both sides are fitted against one another, so the pair never degrades unevenly: a card showing
  // one side's distance from the mid and not the other's reads as the second side having none.
  const sides = [true, false].map((isAToB) => sideVariants(leg, isAToB)).filter((v): v is Seg[][] => v !== null);
  for (const segs of sides.length === 0 ? [] : fitTogether(sides, inner)) {
    rows.push(<Segments segs={segs} />);
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
      // The accent, here and on the row below it: the shift is the product's own signal, and it is
      // the one thing on this card the brand colour is spent on.
      <Text color={UI.signal}>
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
              { text: `${label} `, color: UI.signal },
              ...gauge.map((span) => ({
                text: span.text,
                color:
                  span.term === "correction" ? TERM.correction : span.term === "concession" ? TERM.concession : UI.frame,
              })),
              { text: tail, color: UI.muted },
            ],
            [
              { text: label, color: UI.signal },
              { text: tail, color: UI.muted },
            ],
            [{ text: label, color: UI.heading }],
          ],
          inner,
        )}
      />,
    );
  }

  // What this leg has actually done, in the rows the venue price used to take: how many fills it has
  // taken and what it made trading them. Both come from the data layer's own arithmetic; a null is a
  // dash with its reason on the pnl page, never a zero the card invented.
  if (leg.pnl !== null) {
    const decimals = leg.config.tokenA.decimals;
    const symbol = leg.config.tokenA.symbol;
    const { fills, volumeA, tradingA, edgeA } = leg.pnl;
    const count = `${fills} fill${fills === 1 ? "" : "s"}`;
    const traded = `${tokenAmount(volumeA, decimals)} ${symbol}`;
    const earned =
      tradingA === null
        ? [{ text: "edge ", color: UI.muted }, { text: `${edgeA > 0n ? "+" : ""}${tokenAmount(edgeA, decimals)}`, color: edgeA < 0n ? UI.rejection : UI.fill }]
        : [
            { text: "traded ", color: UI.muted },
            {
              text: `${tradingA > 0n ? "+" : ""}${tokenAmount(tradingA, decimals)} ${symbol}`,
              color: tradingA < 0n ? UI.rejection : UI.fill,
            },
          ];
    rows.push(
      <Segments
        segs={fitSegments(
          [
            [{ text: `${count} · ${traded}  `, color: UI.muted }, ...earned],
            [{ text: `${count}  `, color: UI.muted }, ...earned],
            [{ text: count, color: UI.muted }],
          ],
          inner,
        )}
      />,
    );
  }

  // The leg's own line: the shift it has been published at, over whatever the feed holds.
  //
  // Not a price. The book quotes from one mainnet mark, so a price line here would be the same line
  // on all three cards; and the venue prices these cards used to draw were testnet pools an order of
  // magnitude from the market, two of which have since been retired outright. The shift is the
  // number the rest of the card is about, and it is the one thing that differs between the three.
  const shifts = shiftSeries(snapshot, leg.config.chainId);
  const lineRows = Math.min(4, innerRows - rows.length - 1);
  if (shifts.length > 1 && lineRows >= 2) {
    const drawn = plotSigned(shifts, inner, lineRows);
    for (const [i, row] of drawn.rows.entries()) rows.push(<Text key={`spark${i}`} color={colour}>{row}</Text>);
    const over = duration(Number(shifts[shifts.length - 1]!.timestamp - shifts[0]!.timestamp));
    rows.push(
      <Text color={UI.muted}>
        {chooseFit(
          [
            `shift ${signed(drawn.low)} to ${signed(drawn.high)} over ${over}`,
            `shift ${signed(drawn.low)} to ${signed(drawn.high)}`,
            `${signed(drawn.low)} to ${signed(drawn.high)}`,
          ],
          inner,
        )}
      </Text>,
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
