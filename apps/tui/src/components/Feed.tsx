import { Box, Text } from "ink";
import { BOOK, type FoldedRow, type Snapshot, foldRounds } from "@zentis/console-data";
import { duration, signed, tokenAmount } from "../format.js";
import { type Seg, fitSegments, padRows, trunc } from "../layout.js";
import { Segments } from "./Segments.js";
import { UI, legColour } from "../theme.js";

/** A chain as the rest of the screen names it, so no reader has to learn that SEP means Sepolia. */
const nameOf = (snapshot: Snapshot, chainId: number): string =>
  snapshot.legs.find((l) => l.config.chainId === chainId)?.config.label.split(" ")[0] ?? String(chainId);

/** A shift, and whether it is sitting on the leg's signed cap — where −500 is a limit, not a size. */
function shiftSegs(snapshot: Snapshot, chainId: number, tiltBps: number): Seg[] {
  const leg = snapshot.legs.find((l) => l.config.chainId === chainId);
  const cap = leg?.position?.maxTiltBps ?? BOOK.maxTiltBps;
  return [
    { text: " " },
    { text: nameOf(snapshot, chainId), color: legColour(chainId) },
    { text: ` ${signed(tiltBps)}`, color: UI.heading },
    ...(Math.abs(tiltBps) >= cap ? [{ text: " at cap", color: UI.muted }] : []),
  ];
}

/**
 * Why a publish row lists fewer legs than the book has.
 *
 * The workflow writes every leg in one publish. A row listing one leg usually means the console could
 * not read the other two, and saying "on 1 leg" read as the workflow having written only one.
 */
function missingSegs(snapshot: Snapshot, present: number[]): Seg[] {
  const absent = snapshot.legs.filter((l) => !present.includes(l.config.chainId));
  if (absent.length === 0) return [];
  const unread = absent.filter((l) => l.sources.fills !== null).length;
  const n = (k: number) => `${k} leg${k === 1 ? "" : "s"}`;
  return [
    {
      text: unread > 0 ? ` · ${n(unread)} unread` : ` · ${n(absent.length)} not in this publish`,
      color: UI.caveat,
    },
  ];
}

/**
 * Fills, refusals and publishes on one clock, in the order they happened, each chain in its colour.
 *
 * The refusals are here deliberately and their reason strings are printed as the registry wrote
 * them: `stale seq` is what finality looks like from outside, and the pause in the demo is
 * unintelligible without it. Publishes that changed nothing fold into one row, so the rows that
 * record something happening are not pushed off the bottom by thirteen that did not.
 *
 * Every row is measured before it is drawn. Left to Ink, an overlong row loses characters from
 * inside its numbers: a seq came out as `seq1789029` and a shift of `-349` as `-1`.
 */
function rowSegments(row: FoldedRow, snapshot: Snapshot, width: number): Seg[] {
  const ago = (t: bigint) => duration(snapshot.takenAtSeconds - Number(t));

  if (row.kind === "round" || row.kind === "fold") {
    const time: Seg = {
      text: `${(row.kind === "fold" ? `${ago(row.to)}–${ago(row.from)}` : ago(row.timestamp)).padStart(6)} `,
      color: UI.muted,
    };
    const what: Seg[] =
      row.kind === "fold"
        ? [
            { text: `${row.count} publishes`, color: UI.reference },
            { text: ", unchanged", color: UI.muted },
          ]
        : [
            { text: "publish ", color: UI.reference },
            { text: `seq ${row.seq}`, color: UI.heading },
          ];
    const shifts = row.legs.flatMap((leg) => shiftSegs(snapshot, leg.chainId, leg.tiltBps));
    const bare = row.legs.flatMap((leg): Seg[] => [
      { text: " " },
      { text: signed(leg.tiltBps), color: legColour(leg.chainId) },
    ]);
    const missing = missingSegs(snapshot, row.legs.map((leg) => leg.chainId));
    // "unchanged" is given up before the chain names: which chain a shift belongs to is the
    // information, and "N publishes" with one set of shifts already says they did not change.
    const brief: Seg[] = row.kind === "fold" ? [what[0]!] : what;
    return fitSegments(
      [
        [time, ...what, { text: " ·", color: UI.muted }, ...shifts, ...missing],
        [time, ...what, { text: " ·", color: UI.muted }, ...shifts],
        [time, ...brief, { text: " ·", color: UI.muted }, ...shifts],
        [time, ...what, ...bare, ...missing],
        [time, ...what, ...bare],
        [time, ...what],
      ],
      width,
    );
  }

  const time: Seg = { text: `${ago(row.timestamp).padStart(6)} `, color: UI.muted };
  const chain: Seg = { text: nameOf(snapshot, row.chainId).padEnd(9), color: legColour(row.chainId), bold: true };

  if (row.kind === "rejection") {
    return fitSegments(
      [
        [time, chain, { text: `rejected: ${row.reason}`, color: UI.rejection }],
        [time, chain, { text: row.reason, color: UI.rejection }],
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
  const head: Seg[] = [time, chain, { text: "fill ", color: UI.fill }];

  return fitSegments(
    [
      [...head, { text: amounts, color: UI.heading }, { text: context, color: UI.muted }],
      [...head, { text: amounts, color: UI.heading }],
      [time, chain, { text: "fill", color: UI.fill }],
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
  const body = Math.max(0, rows);
  const shown = foldRounds(snapshot.feed).slice(0, body);

  // A blank region during an outage reads as "nothing has happened", which is a claim. It has not
  // been established that nothing happened; the source that would say so refused.
  const unread = snapshot.legs.map((l) => l.sources.fills).find((e) => e !== null) ?? null;
  const empty =
    unread !== null
      ? `feed unavailable: ${unread}`
      : "nothing indexed yet for this position";

  return (
    <Box flexDirection="column" width={width} height={rows} overflow="hidden">
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
