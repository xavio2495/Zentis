import { Box, Text } from "ink";
import { type LegSnapshot, humanDuration, weightPercent, why } from "@zentis/console-data";
import { signed, tokenAmount } from "../format.js";
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
export function LegDetail({
  leg,
  width,
  height,
}: {
  leg: LegSnapshot;
  width: number;
  height: number;
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

  if (ref !== null) {
    line(
      "ref",
      <>
        <Text color={UI.muted}>{"reference  "}</Text>
        <Text color={UI.reference}>{`seq ${ref.seq}`}</Text>
        <Text color={UI.muted}>
          {`  ${humanDuration(spread?.referenceAgeSeconds ?? 0)} old  ·  mid ${ref.mid}`}
        </Text>
      </>,
    );
  }

  for (const [i, text] of wrapLines(`why  ${why(leg)}`, width - 1, 3).entries()) {
    line(`why${i}`, <Text color={UI.muted}>{text}</Text>);
  }
  for (const [i, caveat] of leg.caveats.entries()) {
    line(`caveat${i}`, <Text color={UI.caveat}>{trunc(`! ${caveat}`, width - 1)}</Text>);
  }

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {padRows(rows, height - 1, null).map((row, i) => (
        <Box key={i} height={1}>
          {row ?? <Text> </Text>}
        </Box>
      ))}
      <Text color={UI.muted}>{trunc("esc  back to the charts", width)}</Text>
    </Box>
  );
}
