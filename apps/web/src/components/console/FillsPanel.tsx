"use client";

import type { Leg } from "@/lib/replay";
import { clock, shortHash, signedBps, tokenAmount } from "@/lib/format";
import { useLegAt } from "@/lib/store";
import { Panel } from "./ui";

/**
 * The fills this leg has taken, as they land.
 *
 * Every row is a real transaction on a public testnet, read through the fills subgraph. The
 * reference this was copied from synthesises its execution legs — four venues and tx hashes cut
 * from a repeating hex string — and that is the one thing from it that could not be copied: a
 * hash on this screen resolves on an explorer or it does not belong here.
 */
export function FillsPanel({ leg }: { leg: Leg | null }) {
  const state = useLegAt(leg);
  const fills = state?.fills ?? [];
  const from = state?.windowFromSeconds ?? 0;

  return (
    <Panel
      title="fills"
      tag={
        leg === null
          ? "waiting"
          : `${leg.label} · fills subgraph · ${state?.inWindow.length ?? 0} of ${fills.length} in this window`
      }
    >
      {fills.length === 0 ? (
        <p className="m-0 text-fs-0 text-ink-faint">no fill yet at this point in the recording</p>
      ) : (
        <table className="tnum w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="text-ink-faint">
              <th className="label-sm py-1 text-left font-normal">when</th>
              <th className="label-sm py-1 text-left font-normal">side</th>
              <th className="label-sm py-1 text-right font-normal">in</th>
              <th className="label-sm py-1 text-right font-normal">out</th>
              <th className="label-sm py-1 text-right font-normal">quoted at</th>
              <th className="label-sm py-1 text-right font-normal">transaction</th>
            </tr>
          </thead>
          <tbody>
            {[...fills].reverse().map((fill) => (
              <tr key={fill.transaction} className="border-t border-stroke">
                <td className="py-1 text-ink-faint">
                  {clock(fill.atSeconds)}
                  {/* The recording keeps the last twenty-five rounds; these fills are older than
                      the first of them, so they are real and simply not on the chart. */}
                  {fill.atSeconds < from ? <span className="ml-2 text-ink-dim">before this window</span> : null}
                </td>
                <td className={`py-1 ${fill.isAToB ? "text-side-a" : "text-side-b"}`}>
                  {fill.isAToB ? "USDC → WETH" : "WETH → USDC"}
                </td>
                <td className="py-1 text-right text-ink">
                  {tokenAmount(fill.amountIn, fill.isAToB ? 6 : 18)}
                </td>
                <td className="py-1 text-right text-ink">
                  {tokenAmount(fill.amountOut, fill.isAToB ? 18 : 6)}
                </td>
                <td className="py-1 text-right text-em">{signedBps(fill.refTiltBps)}</td>
                <td className="py-1 text-right text-ink-soft">{shortHash(fill.transaction)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
