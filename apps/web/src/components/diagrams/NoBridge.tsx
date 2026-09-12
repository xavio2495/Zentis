import { BRIDGE } from "@/lib/mark-geometry";
import type { Moment } from "@/lib/moment";
import { Figure, bps } from "./Figure";

const W = 560;
const H = 220;

/**
 * What crosses, and what does not.
 *
 * Three chains, and between them one signed number and nothing else. There is deliberately no arrow
 * carrying value: the point of the drawing is the absence, and an arrowhead anywhere on it would
 * undo the whole claim. The links are the mark's own connector — the shape in the logo is a bridge
 * between two chains that carries no value, which is the product, so it is the right line to draw.
 */
export function NoBridge({ moment }: { moment: Moment }) {
  const nodes = moment.legs.map((leg, i) => ({
    label: leg.label,
    shift: leg.shiftBps,
    x: W * (0.18 + i * 0.32),
    y: i === 1 ? H * 0.24 : H * 0.62,
  }));

  return (
    <Figure
      caption="Between the chains there is one signed number and nothing else. No inventory moves; the legs are simply allowed to differ, and the book carries the difference."
      source={`recorded moment · seq ${moment.seq} · the book concession, the one term shared across legs`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="three chains with one signed number between them and no value moving">
        <defs>
          {/* The mark's connector, small, used as the link glyph on each edge. */}
          <symbol id="connector" viewBox="0 0 1000 1000">
            <path d={BRIDGE} />
          </symbol>
        </defs>

        {nodes.map((node, i) => {
          const next = nodes[(i + 1) % nodes.length]!;
          const mx = (node.x + next.x) / 2;
          const my = (node.y + next.y) / 2;
          return (
            <g key={`edge-${node.label}`}>
              <line
                x1={node.x}
                x2={next.x}
                y1={node.y}
                y2={next.y}
                stroke="var(--color-stroke)"
                strokeWidth={1}
                strokeDasharray="3 4"
              />
              <use href="#connector" x={mx - 7} y={my - 7} width={14} height={14} fill="var(--color-ink-dim)" />
            </g>
          );
        })}

        {nodes.map((node) => (
          <g key={node.label}>
            <circle cx={node.x} cy={node.y} r={30} fill="var(--color-bg)" stroke="var(--color-line2)" strokeWidth={1} />
            <text x={node.x} y={node.y + 4} textAnchor="middle" className="fill-ink" fontSize={11} fontFamily="var(--font-mono)">
              {bps(node.shift)}
            </text>
            <text x={node.x} y={node.y + 46} textAnchor="middle" className="fill-ink-faint" fontSize={10} fontFamily="var(--font-sans)">
              {node.label}
            </text>
          </g>
        ))}

        <text x={W / 2} y={H - 8} textAnchor="middle" className="fill-ink-soft" fontSize={11} fontFamily="var(--font-mono)">
          crossing between them: {bps(moment.crossChainBps)} bps — a number, not an amount
        </text>
      </svg>
    </Figure>
  );
}
