import { Box, Text } from "ink";
import { weightPercent, type Snapshot } from "@zentis/console-data";
import { since, weightBar } from "../format.js";
import { TERM, UI } from "../theme.js";

/**
 * The claim, in the two lines above everything else: one mid, one book.
 *
 * The seq is the evidence and is therefore printed rather than described — every leg quoting from
 * the same published instant is the whole cross-chain assertion, and a screen that showed three
 * legs without showing they share a number would be showing three positions.
 *
 * Both lines are measured before they are coloured. Ink squeezes a row of adjacent `<Text>` nodes
 * that overruns its box by deleting characters from inside each one, which turned this header into
 * `Zen · USDC/W · 3 leg seq 17890` at eighty columns. So the segments are chosen to fit first, and
 * only what fits is rendered.
 */
interface Segment {
  text: string;
  color: string;
  bold?: boolean;
}

function headerSegments(snapshot: Snapshot, nowSeconds: number, width: number): Segment[] {
  const oldest = snapshot.legs
    .map((leg) => leg.ref?.updatedAt)
    .filter((t): t is bigint => t !== undefined && t !== null)
    .reduce<bigint | null>((min, t) => (min === null || t < min ? t : min), null);

  const age = oldest === null ? "age unknown" : `${since(nowSeconds - Number(oldest))} old`;
  const seq: Segment =
    snapshot.seq === null
      ? { text: "legs on different references", color: UI.rejection }
      : { text: `seq ${snapshot.seq}`, color: UI.reference };

  // Widest first. Each variant is a complete, honest header; narrowing drops context, never digits.
  const variants: Segment[][] = [
    [
      { text: "Zentis", color: UI.heading, bold: true },
      { text: ` · ${snapshot.pair} · ${snapshot.legs.length} legs · `, color: UI.muted },
      seq,
      { text: ` · ${age}`, color: UI.muted },
    ],
    [
      { text: "Zentis", color: UI.heading, bold: true },
      { text: ` · ${snapshot.pair} · `, color: UI.muted },
      seq,
      { text: ` · ${age}`, color: UI.muted },
    ],
    [seq, { text: ` · ${age}`, color: UI.muted }],
    [seq],
  ];

  const fits = variants.find((v) => v.reduce((n, s) => n + s.text.length, 0) <= width);
  return fits ?? [{ text: seq.text.slice(0, Math.max(0, width - 1)) + "…", color: seq.color }];
}

export function BookStrip({
  snapshot,
  nowSeconds,
  width,
}: {
  snapshot: Snapshot;
  nowSeconds: number;
  width: number;
}) {
  const symbol = snapshot.legs[0]?.config.tokenA.symbol ?? "";
  const share = `${weightPercent(snapshot.bookWeightA)}% ${symbol}`;

  // The bar takes what is left after the label, the share and the tagline, and disappears entirely
  // rather than push the numbers off the line.
  const label = "one mid, one book ";
  const tagline = " · no bridging · gains assumed, not read from the enclave";
  const spare = width - label.length - share.length - 3;
  const barWidth = Math.max(0, Math.min(24, spare));
  const room = width - label.length - share.length - barWidth - 3;

  return (
    <Box flexDirection="column">
      <Box>
        {headerSegments(snapshot, nowSeconds, width).map((segment, i) => (
          <Text key={i} color={segment.color} bold={segment.bold === true}>
            {segment.text}
          </Text>
        ))}
      </Box>
      <Box>
        <Text color={UI.muted}>{label}</Text>
        {barWidth > 0 && (
          <>
            <Text color={UI.frame}>{"▕"}</Text>
            <Text color={TERM.correction}>{weightBar(snapshot.bookWeightA, barWidth)}</Text>
            <Text color={UI.frame}>{"▏"}</Text>
          </>
        )}
        <Text color={UI.heading}>{` ${share}`}</Text>
        {room >= tagline.length && <Text color={UI.muted}>{tagline}</Text>}
      </Box>
    </Box>
  );
}
