import { Box, Text } from "ink";
import { BACKFILLING, type LegSnapshot, type Snapshot } from "@zentis/console-data";
import { axisMarks, plot } from "../chart.js";
import { duration } from "../format.js";
import { trunc } from "../layout.js";
import { UI, legColour } from "../theme.js";

/**
 * The reference pools, one line per leg, over the window the volatility term measures.
 *
 * This is what makes the beat visible. A fill lands on one leg; a reference publishes across all
 * three; the other two lines do not move. Said in prose that is a claim, and on the feed it is a
 * sequence of rows a reader has to hold in their head — here it is a picture.
 *
 * Each line is drawn as its own layer rather than merged into one grid, because a merged grid can
 * carry one colour and the whole point is telling the legs apart.
 */
export function Graphs({
  leg,
  snapshot,
  width,
  height,
  windowSeconds,
}: {
  /** the one leg being shown; the region rotates through them rather than stacking all three */
  leg: LegSnapshot;
  snapshot: Snapshot;
  width: number;
  height: number;
  windowSeconds: bigint;
}) {
  const colour = legColour(leg.config.chainId);

  // A blank chart region asserts that the price did not move. Nothing established that — the
  // subgraph that would say so refused, and saying which one and until when is the difference
  // between a console that is broken and one that is waiting.
  if (leg.series === null) {
    // Reading a week of swaps on first start is not a failure, and colouring it like one would make
    // every launch look broken for its first fifteen seconds.
    const reading = leg.sources.pool === BACKFILLING;
    return (
      <Box flexDirection="column" width={width} height={height} overflow="hidden">
        <Text color={reading ? UI.muted : UI.caveat}>
          {trunc(
            leg.sources.pool === null
              ? `no price history for ${leg.config.label} yet`
              : reading
                ? `price history: ${leg.sources.pool}`
                : `price history unavailable: ${leg.sources.pool}`,
            width,
          )}
        </Text>
      </Box>
    );
  }

  const axisRows = 2;
  const p = plot(
    [{ key: "s", samples: leg.series.samples }],
    width,
    Math.max(1, height - axisRows),
    windowSeconds,
  ).byKey.get("s")!;

  // Publishes and fills on the same clock as the line: a tick for a reference, a marker for a fill,
  // because the fill is the event a viewer is looking for.
  const marks = axisMarks(
    snapshot.feed.flatMap((row) =>
      row.kind === "round"
        ? [{ at: row.timestamp, glyph: "│" }]
        : row.kind === "fill" && row.chainId === leg.config.chainId
          ? [{ at: row.timestamp, glyph: "▲" }]
          : [],
    ),
    p.from,
    p.to,
    width,
  );

  const span =
    p.from === null || p.to === null
      ? ""
      : (() => {
          const left = `${duration(Number(p.to - p.from))} ago    ▲ fill   │ publish`;
          return `${left}${" ".repeat(Math.max(1, width - left.length - 3))}now`;
        })();

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {p.rows.map((row, i) => (
        <Box key={i} height={1}>
          <Text color={colour}>{row}</Text>
        </Box>
      ))}
      <Text color={UI.reference}>{marks}</Text>
      <Text color={UI.muted}>{trunc(span, width)}</Text>
    </Box>
  );
}

/** The band a leg's line is drawn in, for the panel title, so the scale is never implied. */
export function extentOf(leg: LegSnapshot, width: number, height: number, windowSeconds: bigint): string {
  if (leg.series === null) return "";
  const p = plot([{ key: "s", samples: leg.series.samples }], width, height, windowSeconds).byKey.get("s")!;
  return (
    `×${p.minRatio.toFixed(3)}–×${p.maxRatio.toFixed(3)} of its own start` +
    (p.clipped > 0 ? `  (${p.clipped} beyond)` : "")
  );
}
