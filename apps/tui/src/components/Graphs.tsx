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
  const legs = snapshot.legs.filter((l) => l.series !== null);
  const axisRows = 2; // the marks row and the time labels
  const bandRows = Math.max(1, Math.floor((height - axisRows) / Math.max(1, legs.length)));

  // One band per leg, each on its own scale and labelled with it. Not one shared axis: a reference
  // pool that steps to a twentieth of where it started and stays there would own the whole range,
  // and the two legs that behaved would draw as flat lines against the frame. What is compared here
  // is the shape of each leg's move, and the label is what stops the bands being read as one number.
  const plots = legs.map((leg) => ({
    leg,
    plot: plot([{ key: "s", samples: leg.series!.samples }], width, bandRows - 1, windowSeconds)
      .byKey.get("s")!,
  }));

  const from = plots.map((p) => p.plot.from).filter((t): t is bigint => t !== null);
  const to = plots.map((p) => p.plot.to).filter((t): t is bigint => t !== null);
  const first = from.length === 0 ? null : from.reduce((a, b) => (a < b ? a : b));
  const last = to.length === 0 ? null : to.reduce((a, b) => (a > b ? a : b));

  // Publishes and fills, on the same clock as the lines: a tick for a reference, a marker for a
  // fill, because the fill is the event a viewer is looking for.
  const marks = axisMarks(
    snapshot.feed.flatMap((row) =>
      row.kind === "round"
        ? [{ at: row.timestamp, glyph: "│" }]
        : row.kind === "fill"
          ? [{ at: row.timestamp, glyph: "▲" }]
          : [],
    ),
    first,
    last,
    width,
  );

  const span =
    first === null || last === null
      ? ""
      : (() => {
          const left = `${duration(Number(last - first))} ago    ▲ fill   │ publish`;
          return `${left}${" ".repeat(Math.max(1, width - left.length - 3))}now`;
        })();

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {plots.map(({ leg, plot: p }) => {
        const colour = legColour(leg.config.chainId);
        const extent =
          `${leg.config.label.split(" ")[0]}  ` +
          `×${p.minRatio.toFixed(3)}–×${p.maxRatio.toFixed(3)} of its own start` +
          (p.clipped > 0 ? `  (${p.clipped} beyond)` : "");
        return (
          <Box key={leg.config.chainId} flexDirection="column" height={bandRows} overflow="hidden">
            <Box height={1}>
              <Segments
                segs={fitSegments(
                  [
                    [{ text: extent, color: colour }],
                    [
                      {
                        text: `${leg.config.label.split(" ")[0]} ×${p.minRatio.toFixed(2)}–×${p.maxRatio.toFixed(2)}`,
                        color: colour,
                      },
                    ],
                    [{ text: leg.config.label.split(" ")[0]!, color: colour }],
                  ],
                  width,
                )}
              />
            </Box>
            {p.rows.map((row, i) => (
              <Box key={i} height={1}>
                <Text color={colour}>{row}</Text>
              </Box>
            ))}
          </Box>
        );
      })}
      <Text color={UI.reference}>{marks}</Text>
      <Text color={UI.muted}>{span}</Text>
    </Box>
  );
}
