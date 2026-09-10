import { Box, Text } from "ink";
import { BACKFILLING, type LegSnapshot, type Snapshot, invertMid } from "@zentis/console-data";
import { axisMarks, plot } from "../chart.js";
import { chooseFit, duration, priceFigure } from "../format.js";
import { quoted } from "../quoted.js";
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

  // Plotted as quoted — one whole tokenB in tokenA — so the line rises when the price in the title
  // rises. The plot is drawn to the right of a gutter holding the prices at the axis's two ends.
  const samples = quoted(leg.series.samples);
  const probe = plot([{ key: "s", samples }], Math.max(1, width - 10), Math.max(1, height - 2), windowSeconds).byKey.get("s")!;
  // The band's ends are in quoted units, so they are turned back into mids before being named.
  const top = priceFigure(invertMid(probe.highMid), leg.config.tokenA, leg.config.tokenB);
  const bottom = priceFigure(invertMid(probe.lowMid), leg.config.tokenA, leg.config.tokenB);
  const gutter = Math.max(top.length, bottom.length) + 1;
  const plotWidth = Math.max(1, width - gutter);
  const p = plot([{ key: "s", samples }], plotWidth, Math.max(1, height - 2), windowSeconds).byKey.get("s")!;

  // Publishes and fills on the same clock as the line. The legend counts what is actually in the
  // window, because a legend that names markers the window does not contain is a promise it breaks.
  type Mark = { at: bigint; glyph: string; kind: "publish" | "fill" };
  const events = snapshot.feed.flatMap((row): Mark[] =>
    row.kind === "round"
      ? [{ at: row.timestamp, glyph: "│", kind: "publish" }]
      : row.kind === "fill" && row.chainId === leg.config.chainId
        ? [{ at: row.timestamp, glyph: "▲", kind: "fill" }]
        : [],
  );
  const inWindow = events.filter((e) => p.from !== null && p.to !== null && e.at >= p.from && e.at <= p.to);
  const marks = axisMarks(inWindow, p.from, p.to, plotWidth);
  const publishes = inWindow.filter((e) => e.kind === "publish").length;
  const fills = inWindow.filter((e) => e.kind === "fill").length;
  const legend =
    publishes + fills === 0
      ? "no fills or publishes in this window"
      : [
          publishes > 0 ? `│ ${publishes} publish${publishes === 1 ? "" : "es"}` : null,
          fills > 0 ? `▲ ${fills} fill${fills === 1 ? "" : "s"}` : null,
        ]
          .filter((part): part is string => part !== null)
          .join("   ");
  const left = p.from === null || p.to === null ? "" : `${duration(Number(p.to - p.from))} ago`;
  const span = `${left}    ${legend}`;

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {p.rows.map((row, i) => (
        <Box key={i} height={1}>
          <Text color={UI.muted}>
            {(i === 0 ? top : i === p.rows.length - 1 ? bottom : "").padStart(gutter - 1).padEnd(gutter)}
          </Text>
          <Text color={colour}>{row}</Text>
        </Box>
      ))}
      <Box height={1}>
        <Text>{" ".repeat(gutter)}</Text>
        <Text color={UI.reference}>{marks}</Text>
      </Box>
      <Box height={1}>
        <Text color={UI.muted}>{" ".repeat(gutter)}</Text>
        <Text color={UI.muted}>
          {chooseFit([`${span}${" ".repeat(Math.max(1, plotWidth - span.length - 3))}now`, span, left], plotWidth)}
        </Text>
      </Box>
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
