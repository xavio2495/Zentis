import type { Moment } from "@/lib/moment";
import { Figure, bps } from "./Figure";

const W = 560;
const ROW = 74;
const BAR = 12;

/**
 * One mid, three legs.
 *
 * The mid is a single line across the drawing because that is the claim: one mainnet reference, and
 * every leg quoting from it. Each leg's inventory is a bar with the even split marked, and its
 * published shift is a tick off the mid line — signed, so the direction it leans is visible without
 * reading the number beside it.
 */
export function MidAndLegs({ moment }: { moment: Moment }) {
  const height = ROW * moment.legs.length + 40;
  // The mid sits clear of the bars: a negative shift ticks back toward them, and at the first
  // geometry Sepolia's −272 reached into its own inventory bar and printed its label on top of it.
  const barW = W * 0.26;
  const barX = 4;
  const midX = W * 0.62;
  // Scaled to the widest shift drawn rather than to the cap: these legs are capped at thousands of
  // basis points and quote in the low hundreds, so a cap-scaled tick is no tick at all.
  const widest = Math.max(...moment.legs.map((l) => Math.abs(l.shiftBps)));
  const tick = (shift: number) => midX + (shift / (widest * 1.4)) * (W * 0.22);

  return (
    <Figure
      caption="One mainnet mid, three legs quoting from it. Each bar is what that leg holds; the tick is how far its quote sits off the mid, and which way it leans."
      source={`recorded moment · seq ${moment.seq} · ${moment.midSource} · bps at BPS 10,000`}
    >
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="one mid with three legs quoting from it">
        <line x1={midX} x2={midX} y1={6} y2={height - 26} stroke="var(--color-ink-faint)" strokeWidth={1} />
        <text x={midX} y={height - 12} textAnchor="middle" className="fill-ink-faint" fontSize={10} fontFamily="var(--font-mono)">
          the mid
        </text>

        {moment.legs.map((leg, i) => {
          const y = 18 + i * ROW;
          return (
            <g key={leg.chainId}>
              <text x={barX} y={y} className="fill-ink-soft" fontSize={11} fontFamily="var(--font-sans)">
                {leg.label}
              </text>
              {/* inventory, with the even split marked: a target the leg is read against */}
              <rect x={barX} y={y + 8} width={barW * leg.shareA} height={BAR} fill="var(--color-side-a)" />
              <rect x={barX + barW * leg.shareA} y={y + 8} width={barW * (1 - leg.shareA)} height={BAR} fill="var(--color-side-b)" />
              <line x1={barX + barW / 2} x2={barX + barW / 2} y1={y + 4} y2={y + BAR + 12} stroke="var(--color-ink)" strokeWidth={1} />
              <text x={barX} y={y + BAR + 24} className="fill-ink-faint" fontSize={9} fontFamily="var(--font-mono)">
                {(leg.shareA * 100).toFixed(1)}% USDC · {((1 - leg.shareA) * 100).toFixed(1)}% WETH
              </text>

              {/* the shift, as a tick off the mid line */}
              <line x1={midX} x2={tick(leg.shiftBps)} y1={y + 14} y2={y + 14} stroke="var(--color-em)" strokeWidth={2} />
              <circle cx={tick(leg.shiftBps)} cy={y + 14} r={2.5} fill="var(--color-em)" />
              {/* A column of its own rather than beside the tick: a label that follows a signed
                  value moves with it, and a long negative one ends up over the bars. */}
              <text x={W - 4} y={y + 18} textAnchor="end" className="fill-ink" fontSize={11} fontFamily="var(--font-mono)">
                {bps(leg.shiftBps)} bps
              </text>
            </g>
          );
        })}
      </svg>
    </Figure>
  );
}
