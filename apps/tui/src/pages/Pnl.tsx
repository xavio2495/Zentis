import { Box, Text } from "ink";
import { type LegSnapshot, type Snapshot, humanDuration } from "@zentis/console-data";
import { tokenAmount } from "../format.js";
import { type Seg, padRows, trunc, wrapLines } from "../layout.js";
import { Segments } from "../components/Segments.js";
import { UI, legColour } from "../theme.js";
import { type Column, columns } from "./table.js";

/**
 * What the book has earned, in the harness's own split: trading, hold, total.
 *
 * Every cell here is either a number the data layer computed or a dash with its reason underneath.
 * The one that matters is hold: it is a price change over time and needs the same price source at
 * both ends, and the generations shipped before the mark was recorded do not have an opening one.
 * Reporting those as zero would claim the maker lived through no price move at all, on testnets
 * whose pools moved thirty per cent in a day. A dash and the sentence is the honest cell.
 */
const signedAmount = (raw: bigint | null, decimals: number): Seg[] =>
  raw === null
    ? [{ text: "—", color: UI.muted }]
    : [
        {
          text: `${raw > 0n ? "+" : ""}${tokenAmount(raw, decimals)}`,
          color: raw < 0n ? UI.rejection : raw > 0n ? UI.fill : UI.heading,
        },
      ];

export function Pnl({ snapshot, width, height }: { snapshot: Snapshot; width: number; height: number }) {
  const legs = snapshot.legs;
  const decimals = legs[0]?.config.tokenA.decimals ?? 6;
  const symbol = legs[0]?.config.tokenA.symbol ?? "";
  const pnlOf = (leg: LegSnapshot) => leg.pnl;

  const cols: Column[] = [
    {
      header: "leg",
      cells: legs.map((leg) => [
        { text: leg.config.label.split(" ")[0] ?? leg.config.name, color: legColour(leg.config.chainId), bold: true },
      ]),
    },
    {
      header: "fills",
      align: "right",
      cells: legs.map((leg) => [{ text: String(pnlOf(leg)?.fills ?? 0), color: UI.heading }]),
    },
    {
      header: `volume ${symbol}`,
      align: "right",
      optional: true,
      cells: legs.map((leg) => {
        const pnl = pnlOf(leg);
        return pnl === null
          ? [{ text: "—", color: UI.muted }]
          : [{ text: tokenAmount(pnl.volumeA, decimals), color: UI.heading }];
      }),
    },
    {
      header: "edge",
      align: "right",
      cells: legs.map((leg) => signedAmount(pnlOf(leg)?.edgeA ?? null, decimals)),
    },
    {
      header: "markout",
      align: "right",
      optional: true,
      cells: legs.map((leg) => signedAmount(pnlOf(leg)?.markoutA ?? null, decimals)),
    },
    {
      header: "trading",
      align: "right",
      cells: legs.map((leg) => signedAmount(pnlOf(leg)?.tradingA ?? null, decimals)),
    },
    {
      header: "hold",
      align: "right",
      cells: legs.map((leg) => signedAmount(pnlOf(leg)?.holdA ?? null, decimals)),
    },
    {
      header: "total",
      align: "right",
      cells: legs.map((leg) => signedAmount(pnlOf(leg)?.totalA ?? null, decimals)),
    },
  ];

  const table = columns(cols, width, legs.length);
  const rows: React.ReactNode[] = [
    <Segments key="head" segs={table.header} />,
    ...table.rows.map((segs, i) => <Segments key={`row${i}`} segs={segs} />),
  ];

  // The book's own line, from the data layer's totals rather than summed here: a page that added up
  // its own rows could disagree with the row above every screen.
  const { book } = snapshot;
  rows.push(
    <Segments
      key="book"
      segs={[
        { text: "book".padEnd(Math.min(8, width)), color: UI.heading, bold: true },
        { text: "  trading ", color: UI.muted },
        ...signedAmount(book.tradingA, decimals),
        { text: "  hold ", color: UI.muted },
        ...signedAmount(book.holdA, decimals),
        { text: "  total ", color: UI.muted },
        ...signedAmount(book.pnlA, decimals),
        { text: ` ${symbol}`, color: UI.muted },
      ]}
    />,
  );
  rows.push(<Text key="sp"> </Text>);

  const mark = legs.find((l) => l.mark !== null)?.mark ?? null;
  if (mark !== null) {
    const age = mark.readAtSeconds === null ? null : Math.max(0, snapshot.takenAtSeconds - mark.readAtSeconds);
    rows.push(
      <Text key="mark" color={UI.muted}>
        {trunc(
          `marked at ${mark.source}${age === null ? "" : `, read ${humanDuration(age)} ago`}` +
            " · each leg's own pool mid is on its card",
          width,
        )}
      </Text>,
    );
  }

  // One reason per distinct caveat: three legs shipped the same day give the same sentence three
  // times, and a page that repeats itself reads as three separate problems.
  const reasons = [...new Set(legs.map((l) => l.pnl?.caveat).filter((c): c is string => c != null))];
  for (const [i, reason] of reasons.entries()) {
    for (const [j, text] of wrapLines(reason, width - 2, 3).entries()) {
      rows.push(
        <Text key={`r${i}-${j}`} color={UI.caveat}>
          {j === 0 ? `! ${text}` : `  ${text}`}
        </Text>,
      );
    }
  }
  if (book.caveat !== null) {
    for (const [j, text] of wrapLines(book.caveat, width - 2, 2).entries()) {
      rows.push(
        <Text key={`bc${j}`} color={UI.caveat}>
          {j === 0 ? `! ${text}` : `  ${text}`}
        </Text>,
      );
    }
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
