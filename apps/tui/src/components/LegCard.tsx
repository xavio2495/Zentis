import { Box, Text } from "ink";
import { type LegSnapshot, humanDuration } from "@zentis/console-data";
import { chooseFit, signed, stackedGauge, tokenAmount, weightBar } from "../format.js";
import { type Seg, fitSegments, trunc } from "../layout.js";
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
}: {
  leg: LegSnapshot;
  index: number;
  width: number;
  height: number;
  selected: boolean;
}) {
  const colour = legColour(leg.config.chainId);
  const state = legState(leg);
  const quote = quoteLine(leg, width - 2);
  const shift = leg.shift;
  const inner = width - 2;

  // The gauge is small and centred on zero: the card says how far off the mid this leg is, and the
  // detail view says what the two terms behind that are.
  const gauge =
    shift === null
      ? []
      : stackedGauge(
          shift.correction,
          shift.concession,
          BigInt(leg.position?.maxTiltBps ?? 500),
          Math.max(8, Math.min(18, inner - 10)),
        );

  const header = fitSegments(
    [
      [
        { text: `${index + 1} ${leg.config.label}`, color: colour, bold: true },
        { text: ` ${state.word}`, color: state.tone },
        ...(selected ? [{ text: " ◂", color: UI.action }] : []),
      ],
      [
        { text: `${index + 1} ${leg.config.label.split(" ")[0]}`, color: colour, bold: true },
        { text: ` ${state.word}`, color: state.tone },
      ],
      // The state outranks the full chain name: a card headed only "Sepolia" during an outage says
      // nothing about why it is empty, which is the one thing the reader needs.
      [
        { text: `${index + 1} ${leg.config.label.split(" ")[0]}`, color: colour, bold: true },
        { text: ` ${state.short}`, color: state.tone },
      ],
      [
        { text: `${index + 1} `, color: colour, bold: true },
        { text: state.short, color: state.tone },
      ],
    ],
    inner,
  );

  const shiftRow: Seg[] =
    shift === null
      ? []
      : fitSegments(
          [
            [
              { text: "shift ", color: UI.muted },
              { text: signed(shift.tiltBps).padEnd(6), color: UI.heading },
              ...gauge.map((span) => ({
                text: span.text,
                color:
                  span.term === "correction"
                    ? TERM.correction
                    : span.term === "concession"
                      ? TERM.concession
                      : UI.frame,
              })),
            ],
            [
              { text: "shift ", color: UI.muted },
              { text: signed(shift.tiltBps), color: UI.heading },
            ],
          ],
          inner,
        );

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden" paddingX={1}>
      <Box height={1}>
        <Segments segs={header} />
      </Box>
      <Box height={1}>
        <Text color={quote.tone}>{quote.text}</Text>
      </Box>
      {leg.position !== null && (
        <Box height={1}>
          <Segments
            segs={fitSegments(
              [
                [
                  { text: "▕", color: UI.frame },
                  { text: weightBar(shift?.weightA ?? 0n, Math.max(6, inner - 8)), color: colour },
                  { text: "▏", color: UI.frame },
                  {
                    text: shift === null ? "" : ` ${Math.round(Number(shift.weightA) / 1e16)}%`,
                    color: UI.muted,
                  },
                ],
                [
                  { text: "▕", color: UI.frame },
                  { text: weightBar(shift?.weightA ?? 0n, Math.max(4, inner - 4)), color: colour },
                  { text: "▏", color: UI.frame },
                ],
              ],
              inner,
            )}
          />
        </Box>
      )}
      {shift !== null && (
        <Box height={1}>
          <Segments segs={shiftRow} />
        </Box>
      )}
      {leg.spread !== null && (
        <Box height={1}>
          <Segments
            segs={fitSegments(
              [
                [
                  { text: "spread ", color: UI.muted },
                  { text: String(leg.spread.totalBps), color: UI.heading },
                  { text: " bps", color: UI.muted },
                ],
                [
                  { text: "spread ", color: UI.muted },
                  { text: String(leg.spread.totalBps), color: UI.heading },
                ],
              ],
              inner,
            )}
          />
        </Box>
      )}
    </Box>
  );
}
