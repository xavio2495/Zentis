"use client";

import { plotShift, xOfTime } from "@/lib/chart";
import type { Leg } from "@/lib/replay";
import { bandState } from "@/lib/replay";
import { signedBps } from "@/lib/format";
import { useLegAt } from "@/lib/store";
import { Panel } from "./ui";

const WIDTH = 800;
const HEIGHT = 260;

/**
 * The shift the enclave published, against the band it is allowed.
 *
 * This is the chart the route exists for: one signed number per round, crossing zero, with the
 * leg's own cap drawn either side of it and every fill marked where it landed. A shift without its
 * band is a number nobody can judge — −251 is nothing on a leg capped at 5,000 and everything on a
 * leg capped at 300.
 *
 * The accent is spent here and almost nowhere else: the line is what Zentis computed.
 */
export function ShiftPanel({ leg }: { leg: Leg | null }) {
  const state = useLegAt(leg);
  if (leg === null || state === null || state.shown.length === 0) {
    return (
      <Panel title="published shift" tag="waiting">
        <p className="m-0 text-fs-0 text-ink-faint">nothing published yet</p>
      </Panel>
    );
  }

  // Plotted over the whole leg, not over what has played: a line that rescaled every tick would
  // make the same shift look different at different moments.
  const plot = plotShift(leg.rounds, { width: WIDTH, height: HEIGHT, edgeBps: leg.maxTiltBps });
  const played = plot.points.slice(0, state.shown.length);
  const now = state.now!;
  const band = bandState(now.tiltBps, leg.maxTiltBps);

  return (
    <Panel
      title="published shift"
      tag={`${leg.label} · cap ±${leg.maxTiltBps} bps${plot.edgeVisible ? "" : ", off this scale"} · BPS 10,000`}
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex items-baseline gap-4">
          <span className="tnum font-mono text-fs-3 leading-none text-em">{signedBps(now.tiltBps)}</span>
          <span className="label-sm text-ink-faint">bps · seq {now.seq}</span>
          <span
            className={`label-sm ${band === "clamped" ? "text-bad" : band === "near edge" ? "text-warn" : "text-ink-faint"}`}
          >
            {band}
          </span>
        </div>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="min-h-0 w-full flex-1"
          role="img"
          aria-label={`published shift for ${leg.label}`}
        >
          {/* The band first, so the line reads against it. */}
          {plot.edgeVisible && (
            <>
              <line x1="0" y1={plot.edge.top} x2={WIDTH} y2={plot.edge.top} stroke="var(--color-line2)" strokeDasharray="4 4" />
              <line
                x1="0"
                y1={plot.edge.bottom}
                x2={WIDTH}
                y2={plot.edge.bottom}
                stroke="var(--color-line2)"
                strokeDasharray="4 4"
              />
            </>
          )}
          <line x1="0" y1={plot.zeroY} x2={WIDTH} y2={plot.zeroY} stroke="var(--color-stroke)" />
          {/* What has not played yet, faint: the shape of the hour is context, not a claim about now. */}
          <polyline points={plot.line} fill="none" stroke="var(--color-ink-dim)" strokeWidth="1" />
          <polyline
            points={played.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke="var(--color-em)"
            strokeWidth="2"
          />
          {/* Where the reference changed source. The shift either side of it was quoted against a
              different mid, so the step is not a price move and the line is not continuous. */}
          {leg.rounds.map((round, index) =>
            round.referenceChanged === true ? (
              <line
                key={`ref${round.seq}`}
                x1={plot.points[index]?.x ?? 0}
                y1="0"
                x2={plot.points[index]?.x ?? 0}
                y2={HEIGHT}
                stroke="var(--color-warn)"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
            ) : null,
          )}
          {state.inWindow.map((fill) => (
            <g key={fill.transaction}>
              <line
                x1={xOfTime(leg.rounds, fill.atSeconds, WIDTH)}
                y1="0"
                x2={xOfTime(leg.rounds, fill.atSeconds, WIDTH)}
                y2={HEIGHT}
                stroke={fill.isAToB ? "var(--color-side-a)" : "var(--color-side-b)"}
                strokeWidth="1"
              />
            </g>
          ))}
          {played.length > 0 && (
            <circle cx={played[played.length - 1]!.x} cy={played[played.length - 1]!.y} r="4" fill="var(--color-em)" />
          )}
        </svg>
        <p className="m-0 text-[10px] text-ink-faint">
          {plot.edgeVisible ? "dashed: this leg’s own cap · " : `the cap is ±${leg.maxTiltBps} bps, well outside this scale · `}
          vertical: a fill inside this window · the faint line is the rest of the recording
          {leg.rounds.some((round) => round.referenceChanged === true)
            ? " · dotted amber: the reference changed source here, so the step across it is not a price move"
            : ""}
        </p>
      </div>
    </Panel>
  );
}
