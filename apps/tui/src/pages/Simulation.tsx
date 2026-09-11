import { Box, Text } from "ink";
import { type SimReport, headline } from "@zentis/console-data";
import { padRows, trunc, wrapLines } from "../layout.js";
import { Segments } from "../components/Segments.js";
import { UI } from "../theme.js";
import { type Column, columns } from "./table.js";

/**
 * The committed simulation run, as a page rather than three lines inside the help overlay.
 *
 * It was a footnote under the disclosures, which is the wrong place for the one number in this
 * project that compares the policy to the alternative. What it claims is narrow and is said in full
 * here: shared seeds, uncalibrated, so it ranks rather than values.
 */
export function Simulation({
  report,
  width,
  height,
}: {
  report: SimReport;
  width: number;
  height: number;
}) {
  const rows: React.ReactNode[] = [
    <Text key="head" color={UI.heading} bold>
      {trunc(headline(report), width)}
    </Text>,
    <Text key="sp1"> </Text>,
  ];

  const regimes = report.regimes;
  const table = columns(
    [
      { header: "regime", cells: regimes.map((r) => [{ text: r.regime, color: UI.heading }]) },
      {
        header: "seeds ahead",
        align: "right",
        cells: regimes.map((r) => [{ text: `${r.seedsAhead}/${r.seeds}`, color: UI.heading }]),
      },
      {
        // Basis points of the opening book, never the raw tokenA figure, which reads as dollars.
        header: "mean bps",
        align: "right",
        cells: regimes.map((r) => [{ text: r.meanBpsOfBook.toFixed(1), color: UI.fill }]),
      },
      {
        header: "worst bps",
        align: "right",
        optional: true,
        cells: regimes.map((r) => [
          {
            text: (r as { worstBpsOfBook?: number }).worstBpsOfBook?.toFixed(1) ?? "—",
            color: UI.caveat,
          },
        ]),
      },
    ] satisfies Column[],
    width,
    regimes.length,
  );
  rows.push(<Segments key="th" segs={table.header} />);
  for (const [i, segs] of table.rows.entries()) rows.push(<Segments key={`r${i}`} segs={segs} />);
  rows.push(<Text key="sp2"> </Text>);

  // What the run claims, and what "uncalibrated" costs it, are in help under this page's heading.
  // The gains and the model it was run at stay, because they are part of the reading.
  rows.push(
    <Text key="params" color={UI.muted}>
      {trunc(
        `own ${report.kappaBps} / book ${report.kappaBookBps} · ${report.signal} · model ${report.modelCommit.slice(0, 10)}`,
        width,
      )}
    </Text>,
  );

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {padRows(rows, height, null).map((row, i) => (
        <Box key={i} height={1}>
          {row ?? <Text> </Text>}
        </Box>
      ))}
    </Box>
  );
}
