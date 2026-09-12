import type { Moment } from "@/lib/moment";
import { Figure, bps } from "./Figure";

const W = 560;
const ROW = 56;
const BAR = 14;

/**
 * The tilt, term by term.
 *
 * The correction comes first because it is computed first: it puts the leg's own curve back on the
 * mid it drifted from. The concession is laid on top of it, and the two together are the published
 * shift — which is drawn as a tick, so agreement is something the reader sees rather than something
 * the page asserts.
 *
 * What is deliberately *not* drawn is own + book as two segments of the stack. Those sum to the
 * concession before the boundary cuts it, so a stack built from them adds up to a shift the enclave
 * never published. They are named underneath instead, with whatever the boundary took.
 */
export function Tilt({ moment }: { moment: Moment }) {
  const height = ROW * moment.legs.length + 34;
  const zero = W * 0.42;
  const widest = Math.max(...moment.legs.map((l) => l.boundaryBps));
  const at = (value: number) => zero + (value / (widest * 1.15)) * (W * 0.42);

  return (
    <Figure
      caption="Each leg's quote is a correction back onto the mid, plus a concession for the inventory it holds. The bracket is the boundary — the most that leg may concede, priced off a real bridge quote."
      source={`recorded moment · seq ${moment.seq} · console recomputation beside the published shift`}
    >
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="the tilt as a correction plus a bounded concession, per leg">
        <line x1={zero} x2={zero} y1={4} y2={height - 20} stroke="var(--color-line2)" strokeWidth={1} />

        {moment.legs.map((leg, i) => {
          const y = 14 + i * ROW;
          const correctionEnd = at(leg.correctionBps);
          const shiftEnd = at(leg.shiftBps);
          const boundary = at(leg.shiftBps >= 0 ? leg.boundaryBps : -leg.boundaryBps);
          return (
            <g key={leg.chainId}>
              <text x={4} y={y} className="fill-ink-soft" fontSize={11} fontFamily="var(--font-sans)">
                {leg.label}
              </text>

              {/* the boundary, as a bracket the concession is not allowed past */}
              <line x1={boundary} x2={boundary} y1={y + 2} y2={y + BAR + 10} stroke="var(--color-ink-dim)" strokeWidth={1} />
              <line
                x1={Math.min(shiftEnd, boundary)}
                x2={Math.max(shiftEnd, boundary)}
                y1={y + BAR + 10}
                y2={y + BAR + 10}
                stroke="var(--color-ink-dim)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />

              {/* correction from zero, then what survived the boundary laid on top of it */}
              <rect
                x={Math.min(zero, correctionEnd)}
                y={y + 6}
                width={Math.abs(correctionEnd - zero)}
                height={BAR}
                fill="var(--color-line2)"
              />
              <rect
                x={Math.min(correctionEnd, shiftEnd)}
                y={y + 6}
                width={Math.abs(shiftEnd - correctionEnd)}
                height={BAR}
                fill="var(--color-em)"
                fillOpacity={0.45}
              />

              {/* the enclave's own number: on the bar's end wherever the two agree */}
              <line x1={shiftEnd} x2={shiftEnd} y1={y + 2} y2={y + BAR + 6} stroke="var(--color-ink)" strokeWidth={2} />

              <text x={4} y={y + BAR + 18} className="fill-ink-faint" fontSize={9} fontFamily="var(--font-mono)">
                correction {bps(leg.correctionBps)} · concession {bps(leg.concessionBps)} (own {bps(leg.ownBps)}, book{" "}
                {bps(leg.bookBps)})
                {leg.cutByBoundaryBps === null ? "" : ` · boundary took ${Math.abs(leg.cutByBoundaryBps)}`} · published{" "}
                {bps(leg.shiftBps)}
              </text>
            </g>
          );
        })}
      </svg>
    </Figure>
  );
}
