"use client";

import { useMemo } from "react";
import { clock, shortHash, signedBps } from "@/lib/format";
import { buildFeed } from "@/lib/feed";
import type { Leg } from "@/lib/replay";
import { Panel } from "./ui";

/**
 * Everything that happened, newest first, with one publish counted once.
 *
 * Three rounds carrying the same seq are one event reaching three chains, not three events. The
 * fold is not tidying: it is the project's claim — one book — rendered as a list.
 */
export function FeedPanel({ legs, untilSeconds }: { legs: Leg[]; untilSeconds: number | null }) {
  const rows = useMemo(
    () => buildFeed(legs, untilSeconds ?? Number.POSITIVE_INFINITY).slice(0, 200),
    [legs, untilSeconds],
  );

  return (
    <Panel title="feed" tag={`${rows.length} shown · publishes folded by seq`} className="min-h-[240px]">
      {rows.length === 0 ? (
        <p className="m-0 text-fs-0 text-ink-faint">nothing yet at this point in the recording</p>
      ) : (
        <div className="h-full overflow-y-auto">
          <table className="w-full border-collapse text-[11px]">
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-stroke/60 align-top">
                  <td className="tnum whitespace-nowrap py-1 pr-3 font-mono text-ink-faint">{clock(row.atSeconds)}</td>
                  <td className="py-1 pr-3">
                    <span
                      className={
                        row.kind === "publish" ? "text-em" : row.kind === "fill" ? "text-side-a" : "text-bad"
                      }
                    >
                      {row.kind}
                    </span>
                  </td>
                  <td className="py-1 pr-3 text-ink-faint">
                    {row.acrossAll ? "all three legs" : row.legs.join(", ")}
                    {/* The legs publish the same seq seconds apart, so a row cut between them has
                        been carried by one leg so far. Saying that is the difference between a
                        publish in flight and a publish two legs missed. */}
                    {row.stillArriving ? (
                      <span className="text-ink-dim"> · {row.legs.length} of {row.legsEver} so far</span>
                    ) : null}
                  </td>
                  <td className="tnum py-1 pr-3 font-mono text-ink-soft">
                    {row.seq === null ? "" : `seq ${row.seq}`}
                    {row.tiltBps === null ? "" : ` ${signedBps(row.tiltBps)} bps`}
                  </td>
                  <td className="py-1 pr-3 text-ink-soft">
                    {row.detail}
                    {row.thisGeneration === false ? (
                      <span className="text-ink-faint"> · before this generation</span>
                    ) : null}
                    {row.referenceChanged ? (
                      <span className="text-warn"> · the reference changed source here, so nothing is computed across it</span>
                    ) : null}
                  </td>
                  <td className="tnum py-1 text-right font-mono text-ink-faint">
                    {row.transaction === null ? "" : shortHash(row.transaction)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
