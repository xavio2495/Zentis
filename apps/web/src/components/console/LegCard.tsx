"use client";

import { ago, signedBps, tokenAmount } from "@/lib/format";
import { inventorySplit, shiftStack, spreadBars } from "@/lib/leg-cards";
import type { Leg, LegQuote, StatusKind } from "@/lib/replay";
import { Panel, Stat } from "./ui";

/**
 * One leg, as a card: what it holds, what it quotes, why it quotes there, and what it has earned.
 *
 * The card's job is to make the pair the project rests on legible — the shift the console
 * recomputes beside the shift the enclave published. Everything else on it is the working that
 * leads to that pair, which is why the decomposition sits directly under the two numbers.
 */
export function LegCard({ leg }: { leg: Leg }) {
  const shift = leg.decomposition === undefined ? null : shiftStack(leg.decomposition);
  const split = inventorySplit(leg.decomposition?.weightA ?? null);
  const bars = leg.spread === undefined ? [] : spreadBars(leg.spread);

  return (
    <Panel title={leg.label} tag={leg.status ?? "unread"} className="min-h-[420px] xl:min-h-0">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto scroll">
        <Holds leg={leg} split={split} />
        {shift === null ? null : <Shift shift={shift} />}
        {leg.quotes === undefined ? null : <Quotes quotes={leg.quotes} />}
        {leg.spread === undefined ? null : <Spread bars={bars} total={leg.spread.totalBps} spread={leg.spread} />}
        <Earned leg={leg} />
      </div>
    </Panel>
  );
}

/** Holds, and the inventory bar with the even split marked on it. */
function Holds({ leg, split }: { leg: Leg; split: ReturnType<typeof inventorySplit> }) {
  return (
    <section className="flex shrink-0 flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="holds A" value={`${tokenAmount(leg.balanceA, 6)} USDC`} tone="soft" />
        <Stat label="holds B" value={`${tokenAmount(leg.balanceB, 18)} WETH`} tone="soft" />
      </div>
      {split === null ? (
        <p className="m-0 text-[10px] text-ink-faint">inventory unread — no weight to draw</p>
      ) : (
        <>
          <div className="relative h-2 w-full bg-inset">
            <div className="h-full bg-side-a" style={{ width: `${split.shareA * 100}%` }} />
            <div className="h-full bg-side-b absolute top-0 right-0" style={{ width: `${(1 - split.shareA) * 100}%` }} />
            {/* The even split: a target the leg is read against, not a limit it is held to. */}
            <div className="absolute top-[-2px] bottom-[-2px] w-px bg-ink" style={{ left: `${split.evenAt * 100}%` }} />
          </div>
          <p className="m-0 text-[10px] text-ink-faint">
            <span className="text-side-a">{(split.shareA * 100).toFixed(1)}% USDC</span> ·{" "}
            <span className="text-side-b">{((1 - split.shareA) * 100).toFixed(1)}% WETH</span> · the tick is an even split
          </p>
        </>
      )}
    </section>
  );
}

/** The pair the project rests on, with the working that produced it. */
function Shift({ shift }: { shift: ReturnType<typeof shiftStack> }) {
  return (
    <section className="flex shrink-0 flex-col gap-1.5 border-t border-stroke pt-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tnum font-mono text-fs-2 leading-tight text-em">{signedBps(shift.total)}</span>
        <span className="label-sm text-ink-faint">bps recomputed</span>
        <span className="tnum font-mono text-fs-1 leading-tight text-ink-soft">{signedBps(shift.published)}</span>
        <span className="label-sm text-ink-faint">published</span>
      </div>

      {/* A diverging bar: correction from zero, then what was conceded on top of it. */}
      <div className="relative h-5 w-full bg-inset">
        {shift.terms.map((term) => (
          <div
            key={term.key}
            className={term.key === "correction" ? "absolute top-0 h-full bg-line2" : "absolute top-0 h-full bg-em/40"}
            style={{ left: `${Math.min(term.from, term.to) * 100}%`, width: `${Math.abs(term.to - term.from) * 100}%` }}
          />
        ))}
        <div className="absolute top-0 bottom-0 w-px bg-ink-dim" style={{ left: `${shift.zeroAt * 100}%` }} />
        {/* The enclave's number as a tick: where the two agree it sits on the bar's own end. */}
        <div
          className={`absolute top-[-3px] bottom-[-3px] w-[2px] ${shift.disputed ? "bg-bad" : "bg-ink"}`}
          style={{ left: `${shift.publishedAt * 100}%` }}
        />
      </div>

      <p className="m-0 text-[10px] leading-snug text-ink-faint">
        correction <span className="tnum text-ink-soft">{signedBps(shift.terms[0]!.bps)}</span> · concession{" "}
        <span className="tnum text-ink-soft">{signedBps(shift.terms[1]!.bps)}</span> (own {signedBps(shift.own)}, book{" "}
        {signedBps(shift.book)}){shift.cutByBoundary === null ? "" : `, boundary took ${Math.abs(shift.cutByBoundary)}`} · room{" "}
        <span className="tnum text-ink-soft">{shift.roomBps}</span> bps
      </p>

      {shift.agrees ? (
        <p className="m-0 text-[10px] text-em">
          the console recomputes the enclave&rsquo;s shift exactly, from the same balances
        </p>
      ) : shift.carriedFromSeq !== null ? (
        <p className="m-0 text-[10px] text-warn">
          carried from seq {shift.carriedFromSeq} — a slow round republishes the last tilt against a re-budgeted
          boundary, so the recomputation lands short rather than disagreeing
        </p>
      ) : (
        <p className="m-0 text-[10px] text-bad">
          the console and the enclave do not agree here, and no carry explains it
        </p>
      )}
    </section>
  );
}

/** Both sides of the book at the recorded size, with each side's distance from the mid. */
function Quotes({ quotes }: { quotes: { aToB: LegQuote; bToA: LegQuote } }) {
  return (
    <section className="flex shrink-0 flex-col gap-1.5 border-t border-stroke pt-2">
      <span className="label-sm text-ink-faint">two-sided, at the recorded size</span>
      <Side quote={quotes.aToB} from="USDC" to="WETH" fromDecimals={6} toDecimals={18} />
      <Side quote={quotes.bToA} from="WETH" to="USDC" fromDecimals={18} toDecimals={6} />
    </section>
  );
}

function Side({
  quote,
  from,
  to,
  fromDecimals,
  toDecimals,
}: {
  quote: LegQuote;
  from: string;
  to: string;
  fromDecimals: number;
  toDecimals: number;
}) {
  if (quote.refusal !== null || quote.amountOut === null) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] text-ink-faint">
          {from} → {to}
        </span>
        {/* The router's own sentence, never a paraphrase: a refusal is evidence. */}
        <span className="text-[10px] text-bad">{quote.refusal?.sentence ?? quote.reason ?? "did not price"}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-tight">
        <span className="text-[11px] text-ink-faint">
          {tokenAmount(quote.amountIn, fromDecimals)} {from} →
        </span>
        <span className="tnum font-mono text-[11px] text-ink">
          {tokenAmount(quote.amountOut, toDecimals)} {to}
        </span>
        <span className={`tnum ml-auto font-mono text-[11px] ${(quote.offMidBps ?? 0) < 0 ? "text-side-b" : "text-side-a"}`}>
          {quote.offMidBps === null ? "—" : `${signedBps(quote.offMidBps)} bps`}
        </span>
      </div>
      {quote.reason === null ? null : <span className="text-[10px] leading-snug text-ink-faint">{quote.reason}</span>}
    </div>
  );
}

/** The four terms the router adds up, each as its share of what it quotes. */
function Spread({ bars, total, spread }: { bars: ReturnType<typeof spreadBars>; total: number; spread: NonNullable<Leg["spread"]> }) {
  return (
    <section className="flex shrink-0 flex-col gap-1.5 border-t border-stroke pt-2">
      <div className="flex items-baseline justify-between">
        <span className="label-sm text-ink-faint">spread</span>
        <span className="tnum font-mono text-[11px] text-ink-soft">{total} bps</span>
      </div>
      <div className="flex h-2 w-full overflow-hidden bg-inset">
        {bars.map((bar, index) => (
          <div
            key={bar.key}
            className="h-full"
            style={{
              width: `${bar.share * 100}%`,
              background: ["var(--color-line2)", "var(--color-ink-dim)", "var(--color-warn)", "var(--color-ink-faint)"][index],
            }}
          />
        ))}
      </div>
      <p className="m-0 text-[10px] leading-snug text-ink-faint">
        {bars.map((bar) => `${bar.label} ${bar.bps}`).join(" · ")} bps
        {spread.tooStaleToQuote ? " · past max staleness: this leg does not quote, it refuses" : ""}
      </p>
      {spread.recomputedVolatilityBps === null ? null : (
        <p className="m-0 text-[10px] text-ink-faint">
          the console makes the volatility term {spread.recomputedVolatilityBps} bps from the series now, beside the{" "}
          {spread.volatilityBps} the workflow published
        </p>
      )}
    </section>
  );
}

/** What the generation has earned, with the position's whole life said separately beside it. */
function Earned({ leg }: { leg: Leg }) {
  const pnl = leg.pnl;
  if (pnl === undefined) return null;
  const usdc = (raw: string | null) => (raw === null ? "—" : `${tokenAmount(raw, 6)} USDC`);
  return (
    <section className="flex shrink-0 flex-col gap-1.5 border-t border-stroke pt-2">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="fills" value={String(pnl.fills)} tone="soft" />
        <Stat label="trading" value={usdc(pnl.tradingA)} tone={pnl.tradingA === null ? "faint" : "soft"} />
        <Stat label="total" value={usdc(pnl.totalA)} tone={pnl.totalA === null ? "faint" : "ink"} />
      </div>
      {pnl.caveat === null ? null : <p className="m-0 text-[10px] text-warn">{pnl.caveat}</p>}
      <p className="m-0 text-[10px] leading-snug text-ink-faint">
        this generation. Since first ship: {pnl.lifetime.fills} fills, trading {usdc(pnl.lifetime.tradingA)}
        {pnl.lifetime.generations === null ? "" : ` across ${pnl.lifetime.generations} generations`}.
      </p>
      {pnl.unvaluedB === null || pnl.unvaluedB === "0" ? null : (
        <p className="m-0 text-[10px] leading-snug text-ink-faint">
          hold is silent about {tokenAmount(pnl.unvaluedB, 18)} WETH pushed in after the ship — valuing it needs a mark
          from the moment of each push, which no record carries.
        </p>
      )}
    </section>
  );
}

/** Kept for the status dot's vocabulary; colour is the screen's business, not the data's. */
export const statusTone = (kind: StatusKind | undefined): "ink" | "soft" | "faint" | "signal" | "warn" | "bad" => {
  switch (kind) {
    case "live":
      return "signal";
    case "docked":
      return "soft";
    case "stale":
      return "warn";
    case "unpriced":
    case "none":
      return "bad";
    default:
      return "faint";
  }
};
