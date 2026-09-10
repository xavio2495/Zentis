import { Box, Text } from "ink";
import type { Snapshot } from "@zentis/console-data";
import { axisMarks, plot } from "../chart.js";
import { duration } from "../format.js";
import { fitSegments } from "../layout.js";
import { Segments } from "./Segments.js";
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
  snapshot,
  width,
  height,
  windowSeconds,
}: {
  snapshot: Snapshot;
  width: number;
  height: number;
  windowSeconds: bigint;
}) {
  const axisRows = 2; // the marks row and the time labels
  const plotHeight = Math.max(1, height - axisRows - 1);
  const legs = snapshot.legs.filter((l) => l.series !== null);

  const { byKey, from, to } = plot(
    legs.map((l) => ({ key: String(l.config.chainId), samples: l.series!.samples })),
    width,
    plotHeight,
    windowSeconds,
  );

  // Publishes and fills, on the same clock as the lines. A reference is a tick; a fill is the letter
  // that names it, because the fill is the event a viewer is looking for.
  const marks = axisMarks(
    snapshot.feed.flatMap((row) =>
      row.kind === "round"
        ? [{ at: row.timestamp, glyph: "│" }]
        : row.kind === "fill"
          ? [{ at: row.timestamp, glyph: "▲" }]
          : [],
    ),
    from,
    to,
    width,
  );

  // Ages rather than clock times: the window is a week, so two wall-clock labels differ by days and
  // read as though the axis ran backwards. "7d ago → now" cannot be misread.
  const span =
    from === null || to === null
      ? ""
      : (() => {
          const left = `${duration(Number(to - from))} ago`;
          return `${left}${" ".repeat(Math.max(1, width - left.length - 3))}now`;
        })();

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Box height={1}>
        <Segments
          segs={fitSegments(
            [
              [
                { text: "reference pools, each normalised to its own start ", color: UI.muted },
                ...legs.map((leg) => ({
                  text: ` ── ${leg.config.label.split(" ")[0]}`,
                  color: legColour(leg.config.chainId),
                })),
              ],
              [
                { text: "reference pools ", color: UI.muted },
                ...legs.map((leg) => ({
                  text: ` ── ${leg.config.label.split(" ")[0]}`,
                  color: legColour(leg.config.chainId),
                })),
              ],
              legs.map((leg) => ({
                text: ` ──${leg.config.label.slice(0, 3)}`,
                color: legColour(leg.config.chainId),
              })),
            ],
            width,
          )}
        />
      </Box>

      {/* Ink cannot overlay boxes, so the three lines are composited in the data and emitted as
          coloured runs; see Overlay. */}
      {Array.from({ length: plotHeight }, (_, row) => (
        <Box key={row}>
          <Overlay legs={legs} byKey={byKey} row={row} width={width} />
        </Box>
      ))}

      <Text color={UI.reference}>{marks}</Text>
      <Text color={UI.muted}>{span}</Text>
    </Box>
  );
}

/**
 * Composites the layers into one row of coloured runs.
 *
 * Ink cannot overlay boxes, so the merge happens in the data: for each cell, the last leg that inked
 * it owns it, and consecutive cells with the same owner become one `<Text>`. That keeps the number
 * of nodes proportional to the number of colour changes rather than to the width.
 */
function Overlay({
  legs,
  byKey,
  row,
  width,
}: {
  legs: { config: { chainId: number } }[];
  byKey: Map<string, { rows: string[] }>;
  row: number;
  width: number;
}) {
  const cells: { char: string; chainId: number | null }[] = Array.from({ length: width }, () => ({
    char: " ",
    chainId: null,
  }));
  for (const leg of legs) {
    const line = byKey.get(String(leg.config.chainId))?.rows[row] ?? "";
    for (let i = 0; i < width; i += 1) {
      const char = line[i];
      if (char !== undefined && char !== " ") cells[i] = { char, chainId: leg.config.chainId };
    }
  }

  const runs: { text: string; chainId: number | null }[] = [];
  for (const cell of cells) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.chainId === cell.chainId) last.text += cell.char;
    else runs.push({ text: cell.char, chainId: cell.chainId });
  }

  return (
    <>
      {runs.map((run, i) => (
        <Text key={i} color={run.chainId === null ? UI.frame : legColour(run.chainId)}>
          {run.text}
        </Text>
      ))}
    </>
  );
}
