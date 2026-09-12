"use client";

import { useMemo } from "react";
import { clock, shortHash, tokenAmount } from "@/lib/format";
import { pnlTable } from "@/lib/feed";
import type { BookTotals, Leg } from "@/lib/replay";
import { Panel } from "./ui";

/** A raw tokenA amount as USDC, or an em dash where the number is genuinely unknown. */
const usdc = (raw: string | null) => (raw === null ? "—" : tokenAmount(raw, 6));

/**
 * What each leg earned, and what the book earned, said separately.
 *
 * The book's row is `bookTotals`' own number and is never a re-sum of the rows above it. Those two
 * disagree the moment a leg cannot be valued — and the screen adding them up would show a book
 * richer than the book, in the one place a judge is most entitled to arithmetic they can trust.
 */
export function PnlPanel({ legs, book }: { legs: Leg[]; book: BookTotals | undefined }) {
  const table = useMemo(() => pnlTable(legs, book), [legs, book]);

  return (
    <Panel title="pnl" tag="this generation · tokenA, from the fills subgraph" className="min-h-[240px]">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="label-sm text-ink-faint">
              <th className="py-1 pr-3 text-left font-normal">leg</th>
              <th className="py-1 pr-3 text-right font-normal">edge</th>
              <th className="py-1 pr-3 text-right font-normal">markout</th>
              <th className="py-1 pr-3 text-right font-normal">trading</th>
              <th className="py-1 pr-3 text-right font-normal">hold</th>
              <th className="py-1 text-right font-normal">total</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.label} className="border-t border-stroke/60">
                <td className="py-1 pr-3 text-ink-soft">{row.label}</td>
                <td className="tnum py-1 pr-3 text-right font-mono text-ink-soft">{usdc(row.edgeA)}</td>
                <td className="tnum py-1 pr-3 text-right font-mono text-ink-soft">{usdc(row.markoutA)}</td>
                <td className="tnum py-1 pr-3 text-right font-mono text-ink-soft">{usdc(row.tradingA)}</td>
                <td className="tnum py-1 pr-3 text-right font-mono text-ink-soft">{usdc(row.holdA)}</td>
                <td className="tnum py-1 text-right font-mono text-ink">{usdc(row.totalA)}</td>
              </tr>
            ))}
            {table.book === null ? null : (
              <tr className="border-t border-line2">
                <td className="py-1 pr-3 text-ink">book</td>
                <td className="tnum py-1 pr-3 text-right font-mono text-ink-faint">{table.book.edgeA}</td>
                <td className="tnum py-1 pr-3 text-right font-mono text-ink-faint">{usdc(table.book.markoutA)}</td>
                <td className="tnum py-1 pr-3 text-right font-mono text-ink-soft">{usdc(table.book.tradingA)}</td>
                <td className="tnum py-1 pr-3 text-right font-mono text-ink-soft">{usdc(table.book.holdA)}</td>
                <td className="tnum py-1 text-right font-mono text-em">{usdc(table.book.totalA)}</td>
              </tr>
            )}
          </tbody>
        </table>

        {table.rows.some((row) => row.caveat !== null) ? (
          <ul className="m-0 list-none p-0 text-[10px] text-warn">
            {table.rows
              .filter((row) => row.caveat !== null)
              .map((row) => (
                <li key={row.label}>
                  {row.label}: {row.caveat}
                </li>
              ))}
          </ul>
        ) : null}

        <p className="m-0 text-[10px] leading-snug text-ink-faint">
          The book&rsquo;s row is the book&rsquo;s own total, not these rows added up: they part company as soon as a leg
          cannot be valued, and the book is the one that knows which could.
        </p>

        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="label-sm text-ink-faint">
              <th className="py-1 pr-3 text-left font-normal">fill</th>
              <th className="py-1 pr-3 text-left font-normal">leg</th>
              <th className="py-1 pr-3 text-right font-normal">size</th>
              <th className="py-1 pr-3 text-right font-normal">edge</th>
              <th className="py-1 pr-3 text-right font-normal">markout</th>
              <th className="py-1 text-right font-normal">tx</th>
            </tr>
          </thead>
          <tbody>
            {table.fills.map((fill) => (
              <tr key={`${fill.label}-${fill.transaction}`} className="border-t border-stroke/60">
                <td className="tnum whitespace-nowrap py-1 pr-3 font-mono text-ink-faint">
                  {clock(fill.atSeconds)}
                  {/* Every fill stays on the list — each is a real transaction and the evidence for
                      a number — but only this generation's are summed into the totals above. */}
                  {fill.thisGeneration ? null : <span className="text-ink-dim"> · earlier generation</span>}
                </td>
                <td className="py-1 pr-3 text-ink-soft">{fill.label}</td>
                <td className="tnum py-1 pr-3 text-right font-mono text-ink-soft">{usdc(fill.sizeA)}</td>
                <td className="tnum py-1 pr-3 text-right font-mono text-ink-soft">{usdc(fill.edgeA)}</td>
                <td className="tnum py-1 pr-3 text-right font-mono text-ink-soft">{usdc(fill.markoutA)}</td>
                <td className="tnum py-1 text-right font-mono text-ink-faint">{shortHash(fill.transaction)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
