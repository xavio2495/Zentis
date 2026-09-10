import { Box, Text } from "ink";
import type { FeedRow, Snapshot } from "@zentis/console-data";
import { clock, duration, signed, tokenAmount } from "../format.js";
import { Divider } from "./Divider.js";
import { UI } from "../theme.js";

const SHORT: Record<number, string> = { 11155111: "SEP", 421614: "ARB", 84532: "BASE" };
const short = (chainId: number) => SHORT[chainId] ?? String(chainId);

/**
 * Fills, refusals and publishes on one clock, in the order they happened.
 *
 * The refusals are here deliberately and their reason strings are printed as the registry wrote
 * them. `stale seq` is not noise on the way to a working system: it is what finality looks like from
 * the outside, and the eighteen-minute pause in the demo is unintelligible without it.
 *
 * A publish is one row however many legs it wrote, which is the cross-chain claim stated as a fact
 * of the log rather than as a sentence — one seq, three shifts, and no transaction on the two legs
 * nobody traded against.
 */
function Row({ row, snapshot }: { row: FeedRow; snapshot: Snapshot }) {
  const legOf = (chainId: number) => snapshot.legs.find((l) => l.config.chainId === chainId);

  if (row.kind === "round") {
    return (
      <Box>
        <Text color={UI.muted}>{clock(row.timestamp)} </Text>
        <Text color={UI.heading}>{"ALL".padEnd(5)}</Text>
        <Text color={UI.reference}>reference </Text>
        <Text color={UI.muted}>seq </Text>
        <Text color={UI.heading}>{row.seq}</Text>
        <Text color={UI.muted}> on {row.count} leg{row.count === 1 ? "" : "s"} · </Text>
        {row.legs.map((leg, i) => (
          <Box key={leg.chainId}>
            <Text color={UI.muted}>{i === 0 ? "" : " "}{short(leg.chainId)} </Text>
            <Text color={UI.heading}>{signed(leg.tiltBps)}</Text>
          </Box>
        ))}
      </Box>
    );
  }

  const leg = legOf(row.chainId);
  return (
    <Box>
      <Text color={UI.muted}>{clock(row.timestamp)} </Text>
      <Text color={UI.heading}>{short(row.chainId).padEnd(5)}</Text>
      {row.kind === "fill" ? (
        <>
          <Text color={UI.fill}>fill </Text>
          <Text color={UI.heading}>
            {tokenAmount(row.amountIn, (row.isAToB ? leg?.config.tokenA.decimals : leg?.config.tokenB.decimals) ?? 18)}{" "}
            {row.isAToB ? leg?.config.tokenA.symbol : leg?.config.tokenB.symbol}
          </Text>
          <Text color={UI.muted}> → </Text>
          <Text color={UI.heading}>
            {tokenAmount(row.amountOut, (row.isAToB ? leg?.config.tokenB.decimals : leg?.config.tokenA.decimals) ?? 18)}{" "}
            {row.isAToB ? leg?.config.tokenB.symbol : leg?.config.tokenA.symbol}
          </Text>
          <Text color={UI.muted}>
            {row.refTiltBps === null
              ? "  (no reference had been published)"
              : `  at shift ${signed(row.refTiltBps)}, on a reference ${duration(Number(row.refAgeSeconds ?? 0n))} old`}
          </Text>
        </>
      ) : (
        <>
          <Text color={UI.rejection}>rejected </Text>
          <Text color={UI.rejection}>{row.reason}</Text>
        </>
      )}
    </Box>
  );
}

export function Feed({ snapshot, width }: { snapshot: Snapshot; width: number }) {
  return (
    <Box flexDirection="column">
      <Divider label="feed" width={width} />
      {snapshot.feed.length === 0 && <Text color={UI.muted}>nothing indexed yet</Text>}
      {snapshot.feed.map((row, i) => (
        <Row key={`${row.kind}-${i}`} row={row} snapshot={snapshot} />
      ))}
    </Box>
  );
}
