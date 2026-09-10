import { Box, Text } from "ink";
import type { Snapshot } from "@zentis/console-data";
import type { Action } from "../action-types.js";
import { Divider } from "./Divider.js";
import { UI } from "../theme.js";

const SHORT: Record<number, string> = { 11155111: "sep", 421614: "arb", 84532: "base" };

/**
 * How far each chain's finalized block trails its head.
 *
 * This is the demo's pause made legible. The fast workflow prices from finalized state, so a fill
 * changes nothing it can see until the block it landed in is final, and the gap below is exactly how
 * much of that wait is left. Blocks, not an estimated wall-clock: block times vary per chain and a
 * converted figure would be a guess dressed as a countdown.
 */
function Finality({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Box>
      <Text color={UI.muted}>finality: </Text>
      {snapshot.legs.map((leg) => (
        <Box key={leg.config.chainId}>
          <Text color={UI.muted}>{SHORT[leg.config.chainId] ?? leg.config.name} </Text>
          <Text color={UI.heading}>
            {leg.finality === null
              ? "—"
              : `${(leg.finality.head - leg.finality.finalized).toLocaleString()} behind`}
          </Text>
          <Text color={UI.muted}> · </Text>
        </Box>
      ))}
    </Box>
  );
}

export function Actions({
  snapshot,
  actions,
  running,
  pending,
  lastResult,
}: {
  snapshot: Snapshot;
  actions: Action[];
  running: string | null;
  pending: Action | null;
  lastResult: string | null;
}) {
  const watchOnly = actions.every((a) => a.disabledReason !== null || a.key === "q");
  return (
    <Box flexDirection="column">
      <Divider label="actions" />
      <Box>
        {actions.map((action) => (
          <Box key={action.key}>
            <Text color={action.disabledReason === null ? UI.action : UI.disabled}>
              [{action.key}] {action.label}
            </Text>
            <Text color={UI.muted}>{"  "}</Text>
          </Box>
        ))}
        <Text color={UI.muted}>[x] quit</Text>
      </Box>
      <Finality snapshot={snapshot} />
      <Box>
        {pending !== null && (
          <Text color={UI.caveat}>
            {pending.describe} — press y to broadcast, any other key to cancel
          </Text>
        )}
        {pending === null && running !== null && <Text color={UI.caveat}>running: {running}</Text>}
        {pending === null && running === null && lastResult !== null && (
          <Text color={UI.muted} wrap="truncate-end">
            {lastResult}
          </Text>
        )}
        {pending === null && running === null && lastResult === null && watchOnly && (
          <Text color={UI.muted}>
            watch-only: no ZENTIS_ENV was given, so nothing here can sign. Re-quote still works.
          </Text>
        )}
      </Box>
    </Box>
  );
}
