"use client";

import { useMemo } from "react";
import { clock } from "@/lib/format";
import { legAgreement, plotMarket, type Marker, type Series } from "@/lib/market-chart";
import type { Leg, MarkHistory } from "@/lib/replay";
import { Panel } from "./ui";

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
  const agreement = useMemo(() => legAgreement(legs), [legs]);

  const plot = useMemo(() => {
    if (market === undefined || market.points.length === 0) return null;
    const legSeries: Series[] = legs.map((leg) => ({
      label: leg.label,
      points: leg.rounds.map((round) => ({ t: round.atSeconds, mid: round.mid })),
    }));
    const markers: Marker[] = legs.flatMap((leg) =>
      leg.fills.map((fill, index) => ({
        t: fill.atSeconds,
        // A fill lands at the market's price at that moment, not at a price of its own: what the
        // marker says is *when* it happened against the series, and the series is the only thing
        // on this axis it can honestly be placed against.
        mid: nearestMid(market, fill.atSeconds),
        key: `${leg.chainId}-${index}`,
      })),
    );
    return plotMarket({ market: { label: "market", points: market.points }, legs: legSeries, markers }, { width: WIDTH, height: HEIGHT });
  }, [legs, market]);

  if (market === undefined || plot === null) {
    return (
      <Panel title="market" tag="waiting">
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
      title="market"
      tag={`${market.source} · ${market.hours}h, ${market.granularity === "hours" ? "hourly" : "per swap"} · USDC/WETH`}
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        {market.error === null ? null : (
          <p className="m-0 text-[10px] text-warn">series stale — {market.error}. The points below are the last good ones.</p>
        )}

        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="w-full flex-1 min-h-[150px]" role="img" aria-label="market price with each leg's published mid">
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
            ? `The legs share one reference by construction, and in this recording they never separate: all ${agreement.shared} publishes carried the same mid on every leg, so the three lines sit exactly under the market's.`
            : `The legs share one reference by construction, but ${agreement.divergent.length} of ${agreement.shared} publishes did not carry the same mid on every leg — the first at seq ${agreement.divergent[0]}.`}
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
