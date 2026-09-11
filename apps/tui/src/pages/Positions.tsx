import { Box, Text } from "ink";
import { type LegSnapshot, type Snapshot, bInA, humanDuration, rebalanceOf } from "@zentis/console-data";
import { signed, tokenAmount } from "../format.js";
import { type Seg, fitSegments, padRows, segWidth, trunc, wrapLines } from "../layout.js";
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
      optional: true,
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
      // marking there reports a fortune that is not in the position. Given up at the narrowest
      // width, where the book row above already carries the same total.
      header: "at mark",
      optional: true,
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

  // What the rows are marked at is in help under this page's heading; a leg that could not be read
  // still says so here, because that changes what its row means.
  for (const [i, leg] of legs.entries()) {
    if (leg.sources.fills === null) continue;
    rows.push(
      <Text key={`c${i}`} color={UI.caveat}>
        {trunc(`${leg.config.label}: ${leg.sources.fills}`, width)}
      </Text>,
    );
  }

  // The rebalance panel: the case pricing cannot cover.
  //
  // A leg whose reserves put its own curve off the mid is corrected by the shift until the cap runs
  // out, and after that it quotes off the market until inventory moves. The panel names the cause
  // rather than the symptom — the balances against the mid, and the tokenB that would close the gap
  // — and gives the command that does it. The amount is the script's own arithmetic, not a second
  // opinion derived from the shift, and a leg a top-up cannot fix is told so instead of being
  // handed a command the script would decline.
  const plans = legs
    .map((leg) => ({
      leg,
      plan:
        leg.position === null || leg.ref === null
          ? null
          : rebalanceOf({ balanceA: leg.position.balanceA, balanceB: leg.position.balanceB, mid: leg.ref.mid }),
    }))
    .filter((entry): entry is { leg: LegSnapshot; plan: NonNullable<typeof entry.plan> } => entry.plan !== null)
    // A gap narrower than the leg's own spread is not worth a transaction: the quote already sits
    // inside it, so moving inventory would change nothing a taker could see. The threshold is the
    // leg's spread rather than a figure chosen here, so it moves when the policy does.
    .map((entry) => ({
      ...entry,
      settled:
        entry.plan.offMidBps !== null &&
        Math.abs(entry.plan.offMidBps) < (entry.leg.spread?.totalBps ?? 0),
    }))
    .filter(({ plan, settled }) => settled || plan.canFix || plan.reason !== null);

  if (plans.length > 0) {
    rows.push(<Text key="rbsp"> </Text>);
    rows.push(
      <Text key="rbhead" color={UI.heading} bold>
        {trunc("rebalance", width)}
      </Text>,
    );
  }
  for (const { leg, plan, settled } of plans) {
    const name = leg.config.label.split(" ")[0] ?? leg.config.name;
    const { tokenA, tokenB } = leg.config;
    if (settled) {
      rows.push(
        <Text key={`rb-${name}-ok`} color={UI.muted}>
          {trunc(`${name} is on the mid, within its own spread of ${leg.spread?.totalBps ?? 0} bps`, width)}
        </Text>,
      );
      continue;
    }
    const held =
      `${name} holds ${tokenAmount(leg.position!.balanceA, tokenA.decimals)} ${tokenA.symbol}` +
      ` and ${tokenAmount(leg.position!.balanceB, tokenB.decimals)} ${tokenB.symbol}` +
      (plan.wantedB === null
        ? ""
        : `, where the mid says ${tokenAmount(plan.wantedB, tokenB.decimals)} ${tokenB.symbol}`);
    for (const [i, text] of wrapLines(held, width, 2).entries()) {
      rows.push(
        <Text key={`rb-${name}-h${i}`} color={UI.muted}>
          {text}
        </Text>,
      );
    }
    if (plan.canFix) {
      // Measured, and split across two rows rather than squeezed into one: left to Ink an overlong
      // row loses characters from inside it, which turned the amount into "top u0.00000958" and the
      // command into "--onl".
      const amount: Seg[] = [
        { text: "top up ", color: UI.muted },
        { text: `${tokenAmount(plan.topUpB, tokenB.decimals)} ${tokenB.symbol}`, color: UI.heading, bold: true },
      ];
      const command: Seg[] = [{ text: `python3 scripts/rebalance.py --only ${leg.config.name}`, color: UI.action }];
      const note: Seg = { text: "  (--dry-run reads it first)", color: UI.muted };
      const joined = [...amount, { text: "  ·  ", color: UI.frame }, ...command, note];
      const oneRow = segWidth(joined) <= width;
      rows.push(<Segments key={`rb-${name}-a`} segs={oneRow ? joined : amount} />);
      if (!oneRow) {
        rows.push(<Segments key={`rb-${name}-c`} segs={fitSegments([[...command, note], command], width)} />);
      }
    } else if (plan.reason !== null) {
      for (const [i, text] of wrapLines(plan.reason, width - 2, 2).entries()) {
        rows.push(
          <Text key={`rb-${name}-r${i}`} color={UI.caveat}>
            {i === 0 ? `! ${text}` : `  ${text}`}
          </Text>,
        );
      }
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
