"use client";

import { useMemo, useState } from "react";
import { clock } from "@/lib/format";
import { clipSeries, legAgreement, plotMarket, publishSpan, trackingGap, type Marker, type Series } from "@/lib/market-chart";
import type { Leg, MarkHistory } from "@/lib/replay";
import { Chip, Panel } from "./ui";

const WIDTH = 800;
const HEIGHT = 220;

/**
 * The one market the book prices from, with the three legs' published mids over the same axis.
 *
 * The legs do not each price from their own pool — two of those testnet pools have been retired and
 * none of them was ever the reference. There is one mainnet USDC/WETH series, the enclave reads it,
 * and all three legs publish the mid it gives them. So the market is drawn once, thick, and the
 * legs go over it as hairlines that should disappear into it.
 *
 * Whether they actually do is computed from the recording rather than claimed: `legAgreement`
 * compares the legs on shared seq, and the legend says what it found. A legend that promised a
 * divergence the seed does not contain would be the panel lying about its own subject.
 */
/**
 * Which slice of time the panel is read at.
 *
 * Over the whole week the legs are a fifth of the axis wide, because a week of market is what the
 * enclave reads and thirty hours of publishing is what this generation has done. Both are worth
 * seeing and neither is the right default for the other, so it is a choice rather than a
 * compromise, and it opens on the span where the legs actually published.
 */
type Span = "publishes" | "week";

export function MarketPanel({
  legs,
  market,
  playedTo,
}: {
  legs: Leg[];
  market: MarkHistory | undefined;
  /** the wall time the playhead is on, so the chart can mark where the replay has reached */
  playedTo: number | null;
}) {
  const [shown, setShown] = useState<Span>("publishes");
  const agreement = useMemo(() => legAgreement(legs), [legs]);
  const span = useMemo(() => publishSpan(legs), [legs]);
  const gap = useMemo(() => trackingGap(legs, market?.points ?? []), [legs, market]);

  const plot = useMemo(() => {
    if (market === undefined || market.points.length === 0) return null;
    const clip = shown === "publishes" && span !== null;
    const legSeries: Series[] = legs.map((leg) => ({
      label: leg.label,
      points: leg.rounds.map((round) => ({ t: round.atSeconds, mid: round.mid })),
    }));
    const marketPoints = clip ? clipSeries(market.points, span.from, span.to, { straddle: true }) : market.points;
    const markers: Marker[] = legs.flatMap((leg) =>
      leg.fills
        .filter((fill) => !clip || (fill.atSeconds >= span.from && fill.atSeconds <= span.to))
        .map((fill, index) => ({
          t: fill.atSeconds,
          // A fill lands at the market's price at that moment, not at a price of its own: what the
          // marker says is *when* it happened against the series, and the series is the only thing
          // on this axis it can honestly be placed against.
          mid: nearestMid(market, fill.atSeconds),
          key: `${leg.chainId}-${index}`,
        })),
    );
    return plotMarket({ market: { label: "market", points: marketPoints }, legs: legSeries, markers }, { width: WIDTH, height: HEIGHT });
  }, [legs, market, shown, span]);

  // Said rather than silently dropped: on the publishing window some fills are older than the
  // oldest round, and a marker quietly missing is a fill the screen has hidden.
  const hidden =
    shown === "publishes" && span !== null
      ? legs.reduce((n, leg) => n + leg.fills.filter((f) => f.atSeconds < span.from || f.atSeconds > span.to).length, 0)
      : 0;

  if (market === undefined || plot === null) {
    return (
      <Panel title="market" tag="waiting" className="min-h-[260px]">
        <p className="m-0 text-fs-0 text-ink-faint">no series recorded</p>
      </Panel>
    );
  }

  const playheadX =
    playedTo === null || plot.window.to <= plot.window.from
      ? null
      : Math.max(0, Math.min(1, (playedTo - plot.window.from) / (plot.window.to - plot.window.from))) * WIDTH;

  return (
    <Panel
      className="min-h-[260px]"
      title="market"
      tag={`${market.source} · ${market.hours}h, ${market.granularity === "hours" ? "hourly" : "per swap"} · USDC/WETH`}
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex shrink-0 items-center gap-2">
          <Chip active={shown === "publishes"} onClick={() => setShown("publishes")} title="the span the legs published over">
            publishes
          </Chip>
          <Chip active={shown === "week"} onClick={() => setShown("week")} title="the whole recorded market series">
            {market.hours}h
          </Chip>
          {hidden === 0 ? null : (
            <span className="text-[10px] text-ink-faint">
              {hidden} earlier {hidden === 1 ? "fill is" : "fills are"} outside this window
            </span>
          )}
        </div>
        {market.error === null ? null : (
          <p className="m-0 text-[10px] text-warn">series stale — {market.error}. The points below are the last good ones.</p>
        )}

        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="min-h-0 w-full flex-1" role="img" aria-label="market price with each leg's published mid">
          {plot.ticks.map((tick) => (
            <line key={tick.price} x1={0} x2={WIDTH} y1={tick.y} y2={tick.y} stroke="var(--color-stroke)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}

          {/* The market, thick and plain: this is the fact, not the signal. */}
          <polyline points={plot.market.line} fill="none" stroke="var(--color-ink-soft)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />

          {/* The legs, hairlines. They should be invisible under the market line; where one is not,
              that is the thing to look at. */}
          {plot.legs.map((series) => (
            <polyline key={series.label} points={series.line} fill="none" stroke="var(--color-em)" strokeOpacity={0.75} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}

          {plot.markers.map((marker) => (
            <circle key={marker.key} cx={marker.x} cy={marker.y} r={3} fill="none" stroke="var(--color-side-a)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}

          {playheadX === null ? null : (
            <line x1={playheadX} x2={playheadX} y1={0} y2={HEIGHT} stroke="var(--color-line2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )}
        </svg>

        <div className="flex shrink-0 items-baseline justify-between gap-3 text-[10px] text-ink-faint">
          <span className="tnum font-mono">{clock(plot.window.from)}</span>
          <span className="tnum font-mono">
            {Math.round(plot.domain.low).toLocaleString("en-US")} – {Math.round(plot.domain.high).toLocaleString("en-US")} USDC/WETH
          </span>
          <span className="tnum font-mono">{clock(plot.window.to)}</span>
        </div>

        <p className="m-0 shrink-0 text-[10px] leading-snug text-ink-faint">
          <span className="text-ink-soft">market</span> is the series above;{" "}
          <span className="text-em">the three legs&rsquo; published mids</span> are drawn over it, and{" "}
          <span className="text-side-a">fills</span> are marked where they landed in time.{" "}
          {agreement.coincide
            ? `The legs share one reference by construction and never separate from each other here: all ${agreement.shared} publishes carried the same mid on every leg, which is why there looks to be one green line rather than three.`
            : `The legs share one reference by construction, but ${agreement.divergent.length} of ${agreement.shared} publishes did not carry the same mid on every leg — the first at seq ${agreement.divergent[0]}.`}{" "}
          {gap.compared === 0
            ? null
            : `Against the market itself they run ${Math.round(gap.meanAbsBps)} bps away on average and ${Math.round(Math.abs(gap.worstBps))} bps at the widest, on ${clock(gap.worstAt)} — part of which is the comparison: the market is ${market.granularity === "hours" ? "hourly closes" : "per-swap"} and the legs publish every few minutes, so a fast move reads as a gap the width of ${market.granularity === "hours" ? "an hour" : "a swap"}.`}
        </p>
      </div>
    </Panel>
  );
}

/** The market's own price nearest a moment: a fill is placed against the series, never above it. */
function nearestMid(market: MarkHistory, atSeconds: number): string {
  let best = market.points[0]!;
  for (const point of market.points) {
    if (Math.abs(point.t - atSeconds) < Math.abs(best.t - atSeconds)) best = point;
  }
  return best.mid;
}
