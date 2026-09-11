import { Box, Text } from "ink";
import { type LegSnapshot, type Snapshot, bInA, humanDuration } from "@zentis/console-data";
import { signed, tokenAmount } from "../format.js";
import { type Seg, padRows, trunc } from "../layout.js";
import { Segments } from "../components/Segments.js";
import { UI, legColour } from "../theme.js";
import { type Column, columns } from "./table.js";

/**
 * The legs as objects: what each one *is*, rather than what it is quoting this second.
 *
 * The live view answers "what is the book doing now"; this page answers "what did we ship, and is
 * it still what we think it is" — the strategy it was shipped as, the block it went out in, what it
 * holds, what that is worth at the mark, and how many generations came before it. A leg that could
 * not be read says so in its own row rather than being left out of the table.
 */
const short = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-4)}`;

/** An integer grouped for reading, the same way amounts are. */
const grouped = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function stateOf(leg: LegSnapshot): Seg {
  if (leg.sources.fills !== null) return { text: "unread", color: UI.caveat };
  if (leg.position === null) return { text: "no position", color: UI.muted };
  return leg.position.active
    ? { text: "active", color: UI.fill }
    : { text: "docked", color: UI.caveat };
}

export function Positions({
  snapshot,
  width,
  height,
}: {
  snapshot: Snapshot;
  width: number;
  height: number;
}) {
  const legs = snapshot.legs;

  const cols: Column[] = [
    {
      header: "leg",
      cells: legs.map((leg) => [
        { text: leg.config.label.split(" ")[0] ?? leg.config.name, color: legColour(leg.config.chainId), bold: true },
      ]),
    },
    {
      header: "strategy",
      optional: true,
      cells: legs.map((leg) => [{ text: short(leg.config.strategyHash), color: UI.muted }]),
    },
    {
      header: "shipped",
      optional: true,
      align: "right",
      cells: legs.map((leg) =>
        leg.config.shipped.block === null
          ? [{ text: "—", color: UI.muted }]
          : [{ text: `block ${grouped(leg.config.shipped.block)}`, color: UI.muted }],
      ),
    },
    {
      header: "gens",
      optional: true,
      align: "right",
      cells: legs.map((leg) => [{ text: String(leg.config.generations), color: UI.muted }]),
    },
    {
      header: "holds",
      cells: legs.map((leg) =>
        leg.position === null
          ? [{ text: "unread", color: UI.caveat }]
          : [
              {
                text:
                  `${tokenAmount(leg.position.balanceA, leg.config.tokenA.decimals)} ${leg.config.tokenA.symbol}` +
                  ` / ${tokenAmount(leg.position.balanceB, leg.config.tokenB.decimals)} ${leg.config.tokenB.symbol}`,
                color: UI.heading,
              },
            ],
      ),
    },
    {
      // Valued at the mainnet mark, like the book row: the leg's own pool is not arbitraged and
      // marking there reports a fortune that is not in the position.
      header: "at mark",
      align: "right",
      cells: legs.map((leg) => {
        const mid = leg.mark?.mid ?? null;
        if (leg.position === null || mid === null || mid === 0n) return [{ text: "—", color: UI.muted }];
        const valued = leg.position.balanceA + bInA(leg.position.balanceB, mid);
        return [
          { text: tokenAmount(valued, leg.config.tokenA.decimals), color: UI.heading },
          { text: ` ${leg.config.tokenA.symbol}`, color: UI.muted },
        ];
      }),
    },
    {
      header: "shift",
      align: "right",
      cells: legs.map((leg) => {
        const tilt = leg.shift?.tiltBps ?? leg.ref?.tiltBps ?? null;
        return tilt === null
          ? [{ text: "—", color: UI.muted }]
          : [{ text: signed(tilt), color: UI.heading }];
      }),
    },
    {
      header: "spread",
      align: "right",
      optional: true,
      cells: legs.map((leg) =>
        leg.spread === null
          ? [{ text: "—", color: UI.muted }]
          : [{ text: String(leg.spread.totalBps), color: UI.heading }],
      ),
    },
    { header: "state", cells: legs.map((leg) => [stateOf(leg)]) },
  ];

  const table = columns(cols, width, legs.length);
  const rows: React.ReactNode[] = [
    <Segments key="head" segs={table.header} />,
    ...table.rows.map((segs, i) => <Segments key={`row${i}`} segs={segs} />),
    <Text key="sp"> </Text>,
  ];

  // What the table cannot hold: the mark each row is valued at, and anything the snapshot flagged.
  const mark = snapshot.legs.find((l) => l.mark !== null)?.mark ?? null;
  if (mark !== null) {
    const age = mark.readAtSeconds === null ? null : Math.max(0, snapshot.takenAtSeconds - mark.readAtSeconds);
    rows.push(
      <Text key="mark" color={UI.muted}>
        {trunc(`marked at ${mark.source}${age === null ? "" : `, read ${humanDuration(age)} ago`}`, width)}
      </Text>,
    );
  }
  for (const [i, leg] of legs.entries()) {
    if (leg.sources.fills === null) continue;
    rows.push(
      <Text key={`c${i}`} color={UI.caveat}>
        {trunc(`${leg.config.label}: ${leg.sources.fills}`, width)}
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
