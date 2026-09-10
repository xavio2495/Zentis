import { Box, Text } from "ink";
import { type SimReport, headline } from "@zentis/console-data";
import { Divider } from "./Divider.js";
import { TERM, UI } from "../theme.js";

/**
 * The honest comparison, from a committed run.
 *
 * Per regime: how many of the shared seeds the policy led static in, and the mean, spread and worst
 * case of that lead in the harness's own units. No "bps saved" — the harness is uncalibrated, so it
 * can rank policies against each other and cannot price either of them, and a figure that looked
 * like money would be claiming otherwise.
 */
export function SimCard({ report, width }: { report: SimReport; width: number }) {
  return (
    <Box flexDirection="column">
      <Divider label="simulation" width={width} />
      <Text color={UI.heading} wrap="truncate-end">
        {headline(report)}
      </Text>
      <Box>
        {report.regimes.map((regime) => (
          <Box key={regime.regime} width={23} flexDirection="column">
            <Box>
              <Text color={UI.muted}>{regime.regime.padEnd(9)}</Text>
              <Text color={regime.seedsAhead === regime.seeds ? TERM.boundary : UI.caveat}>
                {`${regime.seedsAhead}/${regime.seeds}`}
              </Text>
            </Box>
            <Box>
              <Text color={UI.muted}>{"worst".padEnd(9)}</Text>
              <Text color={regime.worstVsStatic > 0 ? TERM.boundary : TERM.markout}>
                {regime.worstVsStatic.toLocaleString()}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
      <Text color={UI.muted} wrap="truncate-end">
        {`${report.unit} · ${report.signal} · own ${report.kappaBps} / book ${report.kappaBookBps} · ${report.ticks} ticks · model ${report.modelCommit.slice(0, 10)}`}
      </Text>
    </Box>
  );
}
