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

  // What the book is marked at, and why hold is unknown, are in help under this page's heading. What
  // stays is the one line that changes what "total" means: a total without hold is not a total.
  // A leg with no pnl at all counts as unvalued too. Reading it as "hold is fine" put the
  // provenance note over a table of dashes during an outage, which advertises the source of a
  // number the page is not showing.
  const unvalued = legs.find((l) => l.pnl == null || l.pnl.holdA == null);
  if (unvalued != null) {
    // The leg's own reason, not a guess at it. There are two ways hold goes unknown — no closing
    // mark, and no opening one — and the page used to print the second whichever had happened,
    // which told an operator with a dead mark service to go looking for a deployment record.
    rows.push(
      <Text key="hold" color={UI.caveat}>
        {trunc(
          `! hold unknown: ${unvalued.pnl?.caveat ?? "this leg has not been read"}, so total is trading only`,
          width,
        )}
      </Text>,
    );
  } else if (legs.some((l) => l.config.shipped.markAtShipSource !== null)) {
    // Hold is known and still worth a flag: its two ends come from different places. The opening
    // mark was backfilled from the hourly series the book is measured on; the closing mark is 1inch
    // spot. One line here, because that is all this page can spare — the record's own sentence, in
    // full, is on the status page, where every number says where it came from.
    rows.push(
      <Text key="hold" color={UI.caveat}>
        {trunc(
          "! hold runs open to close across two sources: the opening mark was backfilled, the close is spot · d status quotes the record",
          width,
        )}
      </Text>,
    );
  }

  // The inventory hold is silent about, named in the leg's own units. Pushing tokenB into a leg
  // after it shipped is an ordinary thing to do — it is how a leg is rebalanced without bridging —
  // and hold values only what the leg was shipped with, so the book's hold understates by whatever
  // that inventory has done since. The page cannot value it, and says so rather than letting the
  // total read as complete.
  const pushed = legs
    .map((leg) => ({ leg, amount: leg.pnl?.unvaluedB ?? 0n }))
    .filter((entry) => entry.amount !== 0n);
  if (pushed.length > 0) {
    const tokenB = pushed[0]!.leg.config.tokenB;
    const total = pushed.reduce((sum, entry) => sum + entry.amount, 0n);
    const named = pushed
      .map((entry) => `${entry.leg.config.label.split(" ")[0]} ${tokenAmount(entry.amount, tokenB.decimals)}`)
      .join(", ");
    for (const [i, line] of wrapLines(
      `! hold covers what each leg was shipped with; ${tokenAmount(total, tokenB.decimals)} ${tokenB.symbol} ` +
        `pushed after that is not in it (${named})`,
      width,
      2,
    ).entries()) {
      rows.push(
        <Text key={`pushed${i}`} color={UI.caveat}>
          {line}
        </Text>,
      );
    }
  }

  // What the totals are made of, in whatever room is left. A page whose lower half is blank has
  // spent it on nothing; the fills are the only thing on this screen that actually moved value, and
  // each one is scored twice — against the reference it was quoted from, and against the next one
  // published after it, which is the adverse selection the spread charges for.
  const perFill = legs
    .flatMap((leg) => (leg.pnl?.perFill ?? []).map((fill) => ({ leg, fill })))
    .sort((a, b) => Number(b.fill.timestamp - a.fill.timestamp));
  const room = height - rows.length - 2;
  if (perFill.length > 0 && room >= 3) {
    const shown = perFill.slice(0, room - 1);
    rows.push(<Text key="pfsp"> </Text>);
    rows.push(
      <Text key="pfhead" color={UI.heading} bold>
        {trunc("per fill", width)}
      </Text>,
    );
    const table = columns(
      [
        {
          header: "when",
          align: "right",
          cells: shown.map(({ fill }) => [
            { text: `${humanDuration(Math.max(0, snapshot.takenAtSeconds - Number(fill.timestamp)))} ago`, color: UI.muted },
          ]),
        },
        {
          header: "leg",
          cells: shown.map(({ leg }) => [
            { text: leg.config.label.split(" ")[0] ?? leg.config.name, color: legColour(leg.config.chainId), bold: true },
          ]),
        },
        {
          header: "side",
          optional: true,
          cells: shown.map(({ leg, fill }) => [
            {
              text: fill.isAToB
                ? `${leg.config.tokenA.symbol} → ${leg.config.tokenB.symbol}`
                : `${leg.config.tokenB.symbol} → ${leg.config.tokenA.symbol}`,
              color: UI.muted,
            },
          ]),
        },
        {
          header: `size ${symbol}`,
          align: "right",
          cells: shown.map(({ fill }) => [{ text: tokenAmount(fill.sizeA, decimals), color: UI.heading }]),
        },
        {
          header: "edge",
          align: "right",
          cells: shown.map(({ fill }) => signedAmount(fill.edgeA, decimals)),
        },
        {
          header: "markout",
          align: "right",
          cells: shown.map(({ fill }) => signedAmount(fill.markoutA, decimals)),
        },
      ],
      width,
      shown.length,
    );
    rows.push(<Segments key="pfth" segs={table.header} />);
    for (const [i, segs] of table.rows.entries()) rows.push(<Segments key={`pf${i}`} segs={segs} />);
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
