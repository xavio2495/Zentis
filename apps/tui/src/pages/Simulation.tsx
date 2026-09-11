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

  for (const [i, text] of wrapLines(
    `Mean and worst are basis points of the ${report.bookInA / 1e6} tokenA opening book, on ${report.signal}. ` +
      `Gains: own ${report.kappaBps}, book ${report.kappaBookBps}. Model ${report.modelCommit.slice(0, 10)}.`,
    width,
    4,
  ).entries()) {
    rows.push(
      <Text key={`u${i}`} color={UI.muted}>
        {text}
      </Text>,
    );
  }
  for (const [i, text] of wrapLines(
    "The simulation ranks this policy against a static one over shared seeds. It is uncalibrated, " +
      "so it says which is ahead and not what either is worth.",
    width,
    4,
  ).entries()) {
    rows.push(
      <Text key={`d${i}`} color={UI.muted}>
        {text}
      </Text>,
    );
  }

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
