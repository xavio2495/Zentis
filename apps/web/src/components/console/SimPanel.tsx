import { Panel } from "./ui";

/**
 * The committed simulation run, and the sentence that says what it does not claim.
 *
 * The caveat travels inside the seed rather than being written here, because a limit that lives
 * beside the numbers instead of inside them is a limit somebody eventually forgets to copy.
 */
export interface SimSeed {
  modelCommit: string;
  generatedAt: string;
  kappaBps: number;
  kappaBookBps: number;
  signal: string;
  caveat: string;
  source: string;
  regimes: { regime: string; seeds: number; seedsAhead: number; meanBpsOfBook: number; worstBpsOfBook: number }[];
}

export function SimPanel({ sim }: { sim: SimSeed | null }) {
  if (sim === null) {
    return (
      <Panel title="policy vs static" tag="waiting">
        <p className="m-0 text-fs-0 text-ink-faint">the committed run has not loaded</p>
      </Panel>
    );
  }
  return (
    <Panel title="policy vs static" tag={`model ${sim.modelCommit.slice(0, 10)} · ${sim.signal}`}>
      <div className="flex h-full min-h-0 flex-col gap-2">
        <table className="tnum w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="text-ink-faint">
              <th className="label-sm py-1 text-left font-normal">regime</th>
              <th className="label-sm py-1 text-right font-normal">seeds ahead</th>
              <th className="label-sm py-1 text-right font-normal">mean bps</th>
              <th className="label-sm py-1 text-right font-normal">worst bps</th>
            </tr>
          </thead>
          <tbody>
            {sim.regimes.map((regime) => (
              <tr key={regime.regime} className="border-t border-stroke">
                <td className="py-1 text-ink">{regime.regime}</td>
                <td className="py-1 text-right text-ink-soft">
                  {regime.seedsAhead}/{regime.seeds}
                </td>
                <td className="py-1 text-right text-ink">{regime.meanBpsOfBook.toFixed(1)}</td>
                <td className="py-1 text-right text-ink-soft">{regime.worstBpsOfBook.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="m-0 text-[10px] text-warn">! {sim.caveat}</p>
        <p className="m-0 text-[10px] text-ink-faint">
          basis points of the opening book · own {sim.kappaBps} / book {sim.kappaBookBps} · {sim.source}
        </p>
      </div>
    </Panel>
  );
}
