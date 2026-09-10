import { Box, Text } from "ink";
import type { FeedEvent, Snapshot } from "@zentis/console-data";
import { clock, signed, weiish } from "../format.js";
import { Divider } from "./Divider.js";
import { UI } from "../theme.js";

const SHORT: Record<number, string> = { 11155111: "SEP", 421614: "ARB", 84532: "BASE" };

/**
 * Fills, references and refusals from all three chains on one clock.
 *
 * The refusals are here deliberately and their reason strings are printed as the registry wrote
 * them. `stale seq` is not noise on the way to a working system: it is what finality looks like from
 * the outside, and the demo's eighteen-minute pause is unintelligible without it.
 */
function Row({ event, snapshot }: { event: FeedEvent; snapshot: Snapshot }) {
  const leg = snapshot.legs.find((l) => l.config.chainId === event.chainId);
  const chain = SHORT[event.chainId] ?? String(event.chainId);

  return (
    <Box>
      <Text color={UI.muted}>{clock(event.timestamp)} </Text>
      <Text color={UI.heading}>{chain.padEnd(5)}</Text>
      {event.kind === "fill" && (
        <>
          <Text color={UI.fill}>fill </Text>
          <Text color={UI.heading}>
            {event.isAToB ? leg?.config.tokenA.symbol : leg?.config.tokenB.symbol}{" "}
            {weiish(event.amountIn, (event.isAToB ? leg?.config.tokenA.decimals : leg?.config.tokenB.decimals) ?? 18)}
          </Text>
          <Text color={UI.muted}> → </Text>
          <Text color={UI.heading}>
            {weiish(event.amountOut, (event.isAToB ? leg?.config.tokenB.decimals : leg?.config.tokenA.decimals) ?? 18)}
          </Text>
          <Text color={UI.muted}>
            {event.refTiltBps === null
              ? "  (no reference had been published)"
              : `  at shift ${signed(event.refTiltBps)}, reference ${event.refAgeSeconds}s old`}
          </Text>
        </>
      )}
      {event.kind === "reference" && (
        <>
          <Text color={UI.reference}>reference </Text>
          <Text color={UI.muted}>seq </Text>
          <Text color={UI.heading}>{event.seq}</Text>
          <Text color={UI.muted}> shift </Text>
          <Text color={UI.heading}>{signed(event.tiltBps)}</Text>
        </>
      )}
      {event.kind === "rejection" && (
        <>
          <Text color={UI.rejection}>rejected </Text>
          <Text color={UI.rejection}>{event.reason}</Text>
        </>
      )}
    </Box>
  );
}

export function Feed({ snapshot, rows }: { snapshot: Snapshot; rows: number }) {
  return (
    <Box flexDirection="column">
      <Divider label="feed" />
      {snapshot.feed.length === 0 && <Text color={UI.muted}>nothing indexed yet</Text>}
      {snapshot.feed.slice(0, rows).map((event, i) => (
        <Row key={`${event.kind}-${event.transaction}-${i}`} event={event} snapshot={snapshot} />
      ))}
    </Box>
  );
}
