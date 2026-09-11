import { Box, Text } from "ink";
import { BACKFILLING, type LegSnapshot, type Snapshot, invertMid } from "@zentis/console-data";
import { axisMarks, plot } from "../chart.js";
import { chooseFit, duration, pairPrice, priceFigure } from "../format.js";
import { quoted } from "../quoted.js";
import { trunc } from "../layout.js";
import { UI, legColour } from "../theme.js";

/**
 * The one market the book prices from, with the beat ticked against it.
 *
 * It used to be three lines, one per leg's reference pool, because each leg quoted from its own.
 * The book prices off a single mainnet mid now and the slow workflow measures the volatility half of
 * its spread on this same series, so three lines would be three drawings of a price nothing quotes
 * from — and two of those pools have been retired outright.
 *
 * What the picture is for has not changed: a fill lands on one leg, a reference publishes across all
 * three, and the market goes on doing whatever it was doing. Ticked on the same clock as the line,
 * that reads as a beat against the market rather than against itself.
 */
export function Graphs({
  snapshot,
  leg,
  width,
  height,
  windowSeconds,
}: {
  snapshot: Snapshot;
  /** the leg whose fills are marked; the line itself belongs to the whole book */
  leg: LegSnapshot;
  width: number;
  height: number;
  windowSeconds: bigint;
}) {
  const market = snapshot.market;
  const tokenA = leg.config.tokenA;
  const tokenB = leg.config.tokenB;

  // A blank chart asserts the market did not move, and nothing read says that.
  if (market === null) {
    const why = snapshot.caveats.find((c) => c.startsWith("the market series")) ?? null;
    return (
      <Box flexDirection="column" width={width} height={height} overflow="hidden">
        <Text color={UI.caveat}>
          {trunc(why ?? "the market series is unavailable, so there is no price history to draw", width)}
        </Text>
      </Box>
    );
  }

  // Plotted as quoted — one whole tokenB in tokenA — so the line rises when the price in the title
  // rises. The plot is drawn to the right of a gutter holding the prices at the axis's two ends.
  const samples = quoted(market.points.map((p) => ({ timestamp: p.timestamp, mid: p.mid })));
  const probe = plot([{ key: "s", samples }], Math.max(1, width - 10), Math.max(1, height - 2), windowSeconds).byKey.get("s")!;
  // The band's ends are in quoted units, so they are turned back into mids before being named.
  const top = priceFigure(invertMid(probe.highMid), tokenA, tokenB);
  const bottom = priceFigure(invertMid(probe.lowMid), tokenA, tokenB);
  const gutter = Math.max(top.length, bottom.length) + 1;
  const plotWidth = Math.max(1, width - gutter);
  const p = plot([{ key: "s", samples }], plotWidth, Math.max(1, height - 2), windowSeconds).byKey.get("s")!;

  // Publishes and fills on the same clock as the line. The legend counts what is actually in the
  // window, because a legend that names markers the window does not contain is a promise it breaks.
  type Mark = { at: bigint; glyph: string; kind: "publish" | "fill" };
  const events = snapshot.feed.flatMap((row): Mark[] =>
    row.kind === "round"
      ? [{ at: row.timestamp, glyph: "│", kind: "publish" }]
      : row.kind === "fill"
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
  // How the series was drawn belongs beside it: a week of hourly closes and an hour of individual
  // swaps are different pictures, and the line alone does not say which one is on screen.
  const drawn = market.granularity === "swaps" ? "per swap" : "hourly";
  const span = `${left}    ${legend}    ${drawn}`;

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {p.rows.map((row, i) => (
        <Box key={i} height={1}>
          <Text color={UI.muted}>
            {(i === 0 ? top : i === p.rows.length - 1 ? bottom : "").padStart(gutter - 1).padEnd(gutter)}
          </Text>
          <Text color={UI.reference}>{row}</Text>
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

/** The title's price: what one tokenB costs in tokenA, at the newest point of the series. */
export function marketPrice(snapshot: Snapshot): string | null {
  const newest = snapshot.market?.points.at(-1) ?? null;
  const leg = snapshot.legs[0];
  if (newest === null || leg === undefined) return null;
  return pairPrice(newest.mid, leg.config.tokenA, leg.config.tokenB);
}
