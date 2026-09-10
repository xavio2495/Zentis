import { Box, Text } from "ink";
import { weightPercent, type Snapshot } from "@zentis/console-data";
import { since, weightBar } from "../format.js";
import { TERM, UI } from "../theme.js";

/**
 * The claim, in the two lines above everything else: one mid, one book.
 *
 * The seq is the evidence and is therefore printed rather than described — every leg quoting from
 * the same published instant is the whole cross-chain assertion, and a screen that showed three
 * legs without showing they share a number would be showing three positions.
 */
export function BookStrip({ snapshot, nowSeconds }: { snapshot: Snapshot; nowSeconds: number }) {
  const symbol = snapshot.legs[0]?.config.tokenA.symbol ?? "";
  const oldest = snapshot.legs
    .map((leg) => leg.ref?.updatedAt)
    .filter((t): t is bigint => t !== undefined && t !== null)
    .reduce<bigint | null>((min, t) => (min === null || t < min ? t : min), null);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={UI.heading} bold>
          Zentis
        </Text>
        <Text color={UI.muted}> · </Text>
        <Text color={UI.heading}>{snapshot.pair}</Text>
        <Text color={UI.muted}> · {snapshot.legs.length} legs · </Text>
        {snapshot.seq === null ? (
          <Text color={UI.rejection}>legs are on different references</Text>
        ) : (
          <>
            <Text color={UI.reference}>seq {snapshot.seq}</Text>
            <Text color={UI.muted}>
              {" "}
              · {oldest === null ? "age unknown" : `${since(nowSeconds - Number(oldest))} old`}
            </Text>
          </>
        )}
      </Box>
      <Box>
        <Text color={UI.muted}>one mid, one book </Text>
        <Text color={UI.frame}>▕</Text>
        <Text color={TERM.correction}>{weightBar(snapshot.bookWeightA, 24)}</Text>
        <Text color={UI.frame}>▏</Text>
        <Text color={UI.heading}>
          {" "}
          {weightPercent(snapshot.bookWeightA)}% {symbol}
        </Text>
        <Text color={UI.muted}> · no bridging · gains assumed, not read from the enclave</Text>
      </Box>
    </Box>
  );
}
