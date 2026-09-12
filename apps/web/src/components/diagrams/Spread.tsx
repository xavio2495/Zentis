import type { Moment } from "@/lib/moment";
import { Figure } from "./Figure";

const W = 560;
const ROW = 46;
const BAR = 14;

const TERMS = [
  { key: "baseBps", label: "base", fill: "var(--color-line2)" },
  { key: "volatilityBps", label: "volatility", fill: "var(--color-ink-dim)" },
  { key: "markoutBps", label: "markout", fill: "var(--color-warn)" },
  { key: "stalenessBps", label: "staleness", fill: "var(--color-ink-faint)" },
] as const;

/**
 * The spread, as the four things it is added up from.
 *
 * Every term is drawn even at zero, and named even at zero: "markout 0" is a fact about what the
 * workflow charged on that leg, and a bar that silently drops it leaves a reader to wonder whether
 * it was nothing or unread. The staleness term is the one that moves between publishes — it is the
 * reference's age turned into width — which is why the caption says the age it was measured at.
 */
export function Spread({ moment }: { moment: Moment }) {
  const height = ROW * moment.legs.length + 30;
  const widest = Math.max(...moment.legs.map((l) => l.spread.totalBps));
  const scale = (W * 0.62) / (widest || 1);
  const left = W * 0.22;

  return (
    <Figure
      caption="Around the tilt sits a spread: a base, a term for volatility, a markout term for how the reference moved after the last fills, and a widening for the reference's own age."
      source={`recorded moment · seq ${moment.seq} · terms as the router adds them, bps`}
    >
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="the spread as base, volatility, markout and staleness">
        {moment.legs.map((leg, i) => {
          const y = 12 + i * ROW;
          let x = left;
          return (
            <g key={leg.chainId}>
              <text x={4} y={y + BAR - 2} className="fill-ink-soft" fontSize={11} fontFamily="var(--font-sans)">
                {leg.label}
              </text>
              {TERMS.map((term) => {
                const value = leg.spread[term.key];
                const w = value * scale;
                const seg = <rect key={term.key} x={x} y={y} width={w} height={BAR} fill={term.fill} />;
                x += w;
                return seg;
              })}
              <text x={x + 8} y={y + BAR - 2} className="fill-ink" fontSize={11} fontFamily="var(--font-mono)">
                {leg.spread.totalBps} bps
              </text>
              <text x={left} y={y + BAR + 13} className="fill-ink-faint" fontSize={9} fontFamily="var(--font-mono)">
                {TERMS.map((t) => `${t.label} ${leg.spread[t.key]}`).join(" · ")}
              </text>
            </g>
          );
        })}
      </svg>
    </Figure>
  );
}
