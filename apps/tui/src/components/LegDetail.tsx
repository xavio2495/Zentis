import { Box, Text } from "ink";
import { type LegSnapshot, humanDuration, invertMid, referenceAgeSeconds, weightPercent, why } from "@zentis/console-data";
import { pairPrice, priceFigure, signed, tokenAmount } from "../format.js";
import { quoted } from "../quoted.js";
import { plot } from "../chart.js";
import { padRows, trunc, wrapLines } from "../layout.js";
import { TERM, UI, legColour } from "../theme.js";

/**
 * One leg in full, in place of the charts.
 *
 * Everything the first console showed on the main screen and could not fit is here, where there is
 * room to name it: the shift's two terms with "before cap" when the cap intervened, the spread's
 * four terms with their names rather than their colours alone, the room against the boundary, the
 * generated why line unclipped, and the reference the whole lot was computed from.
 */
/**
 * How old the leg's reference is, in seconds, or null when the leg has no reference at all.
 *
 * A priced leg's age is the one its spread stack was computed from, so the two agree on screen. An
 * unread leg has no spread stack, but the slot was read from the chain and carries `updatedAt`, so
 * its age is still known. What it must never be is zero for want of a number: the status bar reads
 * the same slot, and "21m" beside "0s old" for one seq is the screen contradicting itself.
 */
// The rule lives in the data layer now, shared with the status bar; re-exported so callers of this
// module keep working.
export { referenceAgeSeconds };

export function LegDetail({
  leg,
  width,
  height,
  windowSeconds,
}: {
  leg: LegSnapshot;
  width: number;
  height: number;
  windowSeconds: bigint;
}) {
  const colour = legColour(leg.config.chainId);
  const { shift, spread, ref, position } = leg;

  const rows: React.ReactNode[] = [];
  const line = (key: string, node: React.ReactNode) => rows.push(<Box key={key}>{node}</Box>);

  line(
    "title",
    <>
      <Text color={colour} bold>
        {leg.config.label}
      </Text>
      <Text color={UI.muted}>{`  ${leg.config.app.slice(0, 10)}…${leg.config.app.slice(-6)}`}</Text>
      <Text color={UI.muted}>{`  chain ${leg.config.chainId}`}</Text>
    </>,
  );

  if (position !== null) {
    line(
      "inv",
      <>
        <Text color={UI.muted}>{"inventory  "}</Text>
        <Text color={UI.heading}>
          {`${tokenAmount(position.balanceA, leg.config.tokenA.decimals)} ${leg.config.tokenA.symbol}` +
            ` / ${tokenAmount(position.balanceB, leg.config.tokenB.decimals)} ${leg.config.tokenB.symbol}`}
        </Text>
        {shift !== null && (
          <Text color={UI.muted}>{`  ${weightPercent(shift.weightA)}% ${leg.config.tokenA.symbol}`}</Text>
        )}
      </>,
    );
  }

  if (shift !== null) {
    // "before cap" is not decoration: -1631 + 1131 is -500 only because the cap intervened, and the
    // three numbers otherwise read as arithmetic that does not work.
    line(
      "shift",
      <>
        <Text color={UI.muted}>{"shift      "}</Text>
        <Text color={UI.heading}>{signed(shift.tiltBps)}</Text>
        {shift.clampedByMaxTilt && (
          <Text color={UI.caveat}>{` (capped at ${position?.maxTiltBps ?? "?"})`}</Text>
        )}
      </>,
    );
    line(
      "terms",
      <>
        <Text color={UI.muted}>{"           "}</Text>
        <Text color={TERM.correction}>{`correction ${signed(shift.correction)}`}</Text>
        <Text color={UI.muted}>{"  +  "}</Text>
        <Text color={TERM.concession}>{`concession ${signed(shift.ownConcession)}`}</Text>
        <Text color={UI.muted}>{"  +  "}</Text>
        <Text color={TERM.bookConcession}>{`book ${signed(shift.bookConcession)}`}</Text>
        {shift.clampedByMaxTilt && <Text color={UI.muted}>{"   before cap"}</Text>}
      </>,
    );
    line(
      "room",
      <>
        <Text color={UI.muted}>{"room       "}</Text>
        <Text color={shift.roomUnknownAtCap ? UI.caveat : TERM.boundary}>
          {shift.roomUnknownAtCap ? "unknown" : String(shift.roomBps)}
        </Text>
        <Text color={UI.muted}>{" of boundary "}</Text>
        <Text color={TERM.boundary}>{String(ref?.bandEdgeBps ?? 0)}</Text>
        {shift.roomUnknownAtCap && (
          <Text color={UI.muted}>{"   the boundary sits on the cap, so it cannot be read back"}</Text>
        )}
      </>,
    );
  }

  if (spread !== null && position !== null) {
    line(
      "spread",
      <>
        <Text color={UI.muted}>{"spread     "}</Text>
        <Text color={UI.heading}>{`${spread.totalBps} bps`}</Text>
      </>,
    );
    line(
      "stack",
      <>
        <Text color={UI.muted}>{"           "}</Text>
        <Text color={TERM.base}>{`base ${spread.baseBps}`}</Text>
        <Text color={UI.muted}>{"  +  "}</Text>
        <Text color={TERM.volatility}>{`volatility ${spread.volatilityBps}`}</Text>
        <Text color={UI.muted}>{"  +  "}</Text>
        <Text color={TERM.markout}>{`markout ${spread.markoutBps}`}</Text>
        <Text color={UI.muted}>{"  +  "}</Text>
        <Text color={TERM.staleness}>{`staleness ${spread.stalenessBps}`}</Text>
      </>,
    );
    line(
      "ramp",
      <>
        <Text color={UI.muted}>{"           "}</Text>
        <Text color={UI.muted}>
          {`${position.widenBpsPerMinute} bps a minute × ${Math.floor(spread.referenceAgeSeconds / 60)}m` +
            (spread.stalenessBps === position.maxWidenBps ? `, at its cap of ${position.maxWidenBps}` : "")}
        </Text>
      </>,
    );
  }

  if (leg.series !== null) {
    line(
      "pool",
      <>
        <Text color={UI.muted}>{"pool       "}</Text>
        <Text color={UI.heading}>{pairPrice(leg.series.mid, leg.config.tokenA, leg.config.tokenB)}</Text>
        <Text color={UI.muted}>{`  ${leg.config.referencePool.slice(0, 10)}…${leg.config.referencePool.slice(-6)}`}</Text>
        {/* Liquidity is not shown: a Uniswap v3 liquidity value is not an amount of either token, and
            printing its fifteen digits said nothing a reader could use. */}
        <Text color={UI.muted}>
          {`  last swap ${humanDuration(
            Math.max(0, Math.floor(Date.now() / 1000) - Number(leg.series.updatedAtTimestamp)),
          )} ago`}
        </Text>
      </>,
    );
  } else if (leg.sources.pool !== null) {
    line("pool", <Text color={UI.caveat}>{trunc(`pool       ${leg.sources.pool}`, width)}</Text>);
  }

  if (ref !== null) {
    line(
      "ref",
      <>
        <Text color={UI.muted}>{"reference  "}</Text>
        <Text color={UI.reference}>{`seq ${ref.seq}`}</Text>
        <Text color={UI.muted}>
          {`  ${humanDuration(referenceAgeSeconds(leg, Math.floor(Date.now() / 1000)) ?? 0)} old  ·  ` +
            `mid ${pairPrice(ref.mid, leg.config.tokenA, leg.config.tokenB)}`}
        </Text>
      </>,
    );
  }

  // Labelled in the same column as `pool` and `reference`, with its continuation lines indented to
  // match. Run straight into its sentence, "why this leg has no…" read as a question.
  const LABEL = 11;
  for (const [i, text] of wrapLines(why(leg), width - 1 - LABEL, 3).entries()) {
    line(
      `why${i}`,
      <>
        <Text color={UI.muted}>{(i === 0 ? "why" : "").padEnd(LABEL)}</Text>
        <Text color={UI.muted}>{text}</Text>
      </>,
    );
  }
  for (const [i, caveat] of leg.caveats.entries()) {
    line(`caveat${i}`, <Text color={UI.caveat}>{trunc(`! ${caveat}`, width - 1)}</Text>);
  }

  // Whatever height is left after the numbers goes to this leg's own price line, so the detail
  // answers "what is it doing" and "why" in one place rather than sending the reader back.
  const sparkRows = height - rows.length - 1;
  if (sparkRows > 1 && leg.series !== null) {
    // As quoted, like the main chart, and labelled with the prices at its ends rather than ratios.
    const p = plot([{ key: "s", samples: quoted(leg.series.samples) }], width, sparkRows - 1, windowSeconds)
      .byKey.get("s")!;
    const low = priceFigure(invertMid(p.lowMid), leg.config.tokenA, leg.config.tokenB);
    const high = priceFigure(invertMid(p.highMid), leg.config.tokenA, leg.config.tokenB);
    line(
      "extent",
      <Text color={UI.muted}>
        {trunc(
          `price      ${low}–${high} ${leg.config.tokenA.symbol} per ${leg.config.tokenB.symbol} over ${humanDuration(Number(windowSeconds))}`,
          width,
        )}
      </Text>,
    );
    for (const [i, row] of p.rows.entries()) {
      line(`spark${i}`, <Text color={colour}>{row}</Text>);
    }
  }

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {padRows(rows, height, null).map((row, i) => (
        <Box key={i} height={1}>
          {row ?? <Text> </Text>}
        </Box>
      ))}
    </Box>
  );
}
