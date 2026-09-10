import { Box, Text } from "ink";
import type { FeedRow, Snapshot } from "@zentis/console-data";
import { duration, signed, tokenAmount } from "../format.js";
import { type Seg, fitSegments, padRows, trunc } from "../layout.js";
import { Segments } from "./Segments.js";
import { UI, legColour } from "../theme.js";

const SHORT: Record<number, string> = { 11155111: "SEP", 421614: "ARB", 84532: "BASE" };
const short = (chainId: number) => SHORT[chainId] ?? String(chainId);

/**
 * Fills, refusals and publishes on one clock, in the order they happened, each row in its leg's
 * colour.
 *
 * The refusals are here deliberately and their reason strings are printed as the registry wrote
 * them: `stale seq` is what finality looks like from outside, and the pause in the demo is
 * unintelligible without it. A publish is one row however many legs it wrote, which states the
 * cross-chain claim as a fact of the log rather than as a sentence.
 *
 * Every row is measured before it is drawn. Left to Ink, an overlong row loses characters from
 * inside its numbers: a seq came out as `seq1789029` and a shift of `-349` as `-1`, both still
 * looking like the thing they no longer were.
 */
function rowSegments(row: FeedRow, snapshot: Snapshot, width: number): Seg[] {
  // An age, not a wall clock. The feed reaches back past midnight, and `21:56:00` sitting under
  // `07:45:00` is yesterday with nothing on the row to say so — which reads as the feed being out of
  // order. Right-aligned so the column stays a column.
  const time = `${duration(snapshot.takenAtSeconds - Number(row.timestamp)).padStart(6)} `;

  if (row.kind === "round") {
    const full = row.legs.flatMap((leg): Seg[] => [
      { text: " " },
      { text: short(leg.chainId), color: legColour(leg.chainId) },
      { text: ` ${signed(leg.tiltBps)}`, color: UI.heading },
    ]);
    const bare = row.legs.flatMap((leg): Seg[] => [
      { text: " " },
      { text: signed(leg.tiltBps), color: legColour(leg.chainId) },
    ]);
    const head: Seg[] = [
      { text: time, color: UI.muted },
      { text: "reference ", color: UI.reference },
      { text: `seq ${row.seq}`, color: UI.heading },
    ];
    return fitSegments(
      [
        [
          ...head,
          { text: ` on ${row.count} leg${row.count === 1 ? "" : "s"} ·`, color: UI.muted },
          ...full,
        ],
        [...head, { text: " ·", color: UI.muted }, ...full],
        [...head, ...bare],
        head,
        [{ text: `${time}seq ${row.seq}`, color: UI.reference }],
      ],
      width,
    );
  }

  const colour = legColour(row.chainId);
  if (row.kind === "rejection") {
    return fitSegments(
      [
        [
          { text: time, color: UI.muted },
          { text: short(row.chainId).padEnd(5), color: colour, bold: true },
          { text: `rejected ${row.reason}`, color: UI.rejection },
        ],
        [
          { text: time, color: UI.muted },
          { text: `${short(row.chainId)} `, color: colour },
          { text: row.reason, color: UI.rejection },
        ],
      ],
      width,
    );
  }

  const leg = snapshot.legs.find((l) => l.config.chainId === row.chainId);
  const inDecimals = (row.isAToB ? leg?.config.tokenA.decimals : leg?.config.tokenB.decimals) ?? 18;
  const outDecimals = (row.isAToB ? leg?.config.tokenB.decimals : leg?.config.tokenA.decimals) ?? 18;
  const inSymbol = (row.isAToB ? leg?.config.tokenA.symbol : leg?.config.tokenB.symbol) ?? "";
  const outSymbol = (row.isAToB ? leg?.config.tokenB.symbol : leg?.config.tokenA.symbol) ?? "";
  const amounts =
    `${tokenAmount(row.amountIn, inDecimals)} ${inSymbol}` +
    ` → ${tokenAmount(row.amountOut, outDecimals)} ${outSymbol}`;
  const context =
    row.refTiltBps === null
      ? "  no reference had been published"
      : `  at shift ${signed(row.refTiltBps)}, reference ${duration(Number(row.refAgeSeconds ?? 0n))} old`;
  const head: Seg[] = [
    { text: time, color: UI.muted },
    { text: short(row.chainId).padEnd(5), color: colour, bold: true },
    { text: "fill ", color: UI.fill },
  ];

  return fitSegments(
    [
      [...head, { text: amounts, color: UI.heading }, { text: context, color: UI.muted }],
      [...head, { text: amounts, color: UI.heading }],
      [
        { text: time, color: UI.muted },
        { text: `${short(row.chainId)} `, color: colour },
        { text: "fill", color: UI.fill },
      ],
    ],
    width,
  );
}

export function Feed({
  snapshot,
  width,
  rows,
}: {
  snapshot: Snapshot;
  width: number;
  rows: number;
}) {
  const body = Math.max(0, rows - 1);
  const shown = snapshot.feed.slice(0, body);

  // A blank region during an outage reads as "nothing has happened", which is a claim. It has not
  // been established that nothing happened; the source that would say so refused.
  const unread = snapshot.legs.map((l) => l.sources.fills).find((e) => e !== null) ?? null;
  const empty =
    unread !== null
      ? `feed unavailable: ${unread}`
      : "nothing indexed yet for this position";

  return (
    <Box flexDirection="column" width={width} height={rows} overflow="hidden">
      <Text color={UI.frame}>{trunc("─ feed ".padEnd(width, "─"), width)}</Text>
      {/* Padded to the region's height so the feed does not resize as events arrive, which would
          drag the charts above it up and down between polls. */}
      {shown.length === 0 && (
        <Box height={1}>
          <Text color={unread === null ? UI.muted : UI.caveat}>{trunc(empty, width)}</Text>
        </Box>
      )}
      {padRows(
        shown.map((row, i) => (
          <Segments key={`${row.kind}-${i}`} segs={rowSegments(row, snapshot, width)} />
        )),
        shown.length === 0 ? Math.max(0, body - 1) : body,
        null,
      ).map((row, i) => (
        <Box key={i} height={1}>
          {row ?? <Text> </Text>}
        </Box>
      ))}
    </Box>
  );
}
