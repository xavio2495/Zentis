import { Box, Text } from "ink";
import { type LegSnapshot, offMidBps, weightPercent, why } from "@zentis/console-data";
import { amount, clampToRows, signed, spreadRow, stackedGauge, weiish } from "../format.js";
import { TERM, UI } from "../theme.js";

const WIDTH = 38;

/**
 * The spread's terms, each in its own colour.
 *
 * The widths come from `spreadRow`, which guarantees the row fits the column. That guarantee is the
 * point: asked to render something too wide, Ink drops characters out of the middle, and on a row of
 * numbers the result still looks like a decomposition while no longer summing to its own total.
 */
function SpreadRow({ leg }: { leg: LegSnapshot }) {
  const spread = leg.spread;
  if (spread === null) return <Text color={UI.muted}>spread —</Text>;
  const { note } = spreadRow(
    spread,
    leg.position?.widenBpsPerMinute ?? 0,
    Math.floor(spread.referenceAgeSeconds / 60),
    WIDTH - 1,
  );
  return (
    <Box>
      <Text color={UI.muted}>{`spread ${spread.totalBps} `}</Text>
      <Text color={TERM.base}>{spread.baseBps}</Text>
      <Text color={UI.muted}>+</Text>
      <Text color={TERM.volatility}>{spread.volatilityBps}</Text>
      <Text color={UI.muted}>+</Text>
      <Text color={TERM.markout}>{spread.markoutBps}</Text>
      <Text color={UI.muted}>+</Text>
      <Text color={TERM.staleness}>{spread.stalenessBps}</Text>
      {note !== "" && <Text color={UI.muted}>{note}</Text>}
    </Box>
  );
}

function ShiftRows({ leg }: { leg: LegSnapshot }) {
  const shift = leg.shift;
  const ref = leg.ref;
  if (shift === null || ref === null) {
    return (
      <Box>
        <Text color={UI.muted}>shift </Text>
        <Text color={UI.heading}>{ref === null ? "—" : signed(ref.tiltBps)}</Text>
        <Text color={UI.caveat}> (not decomposed)</Text>
      </Box>
    );
  }
  const spans = stackedGauge(shift.correction, shift.concession, BigInt(leg.position?.maxTiltBps ?? 500), 24);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={UI.muted}>shift </Text>
        <Text color={UI.heading}>{signed(shift.tiltBps).padEnd(6)}</Text>
        <Text color={TERM.correction}>corr {signed(shift.correction)}</Text>
        <Text color={UI.muted}> | </Text>
        <Text color={TERM.concession}>conc {signed(shift.concession)}</Text>
      </Box>
      <Box>
        <Text color={UI.frame}>{"      ▕"}</Text>
        {spans.map((span, i) => (
          <Text
            key={i}
            color={
              span.term === "correction"
                ? TERM.correction
                : span.term === "concession"
                  ? TERM.concession
                  : UI.frame
            }
          >
            {span.text}
          </Text>
        ))}
        <Text color={UI.frame}>▏</Text>
      </Box>
      <Box>
        <Text color={UI.muted}>room  </Text>
        {/* A leg at its shift cap publishes a boundary equal to the cap, so the room cannot be
            recovered. Printing the zero it arithmetically comes to would assert a budget of none. */}
        <Text color={shift.roomUnknownAtCap ? UI.caveat : TERM.boundary}>
          {(shift.roomUnknownAtCap ? "?" : String(shift.roomBps)).padEnd(6)}
        </Text>
        <Text color={UI.muted}>boundary </Text>
        <Text color={TERM.boundary}>{ref.bandEdgeBps}</Text>
        <Text color={TERM.bookConcession}> book {signed(shift.bookConcession)}</Text>
      </Box>
    </Box>
  );
}

function QuoteRow({ leg }: { leg: LegSnapshot }) {
  const quote = leg.quoteAToB;
  if (quote?.amountOut == null) {
    return <Text color={UI.muted}>quote —{quote === null ? "" : " (the router would not price)"}</Text>;
  }
  const off = offMidBps(quote, true);
  return (
    <Box>
      <Text color={UI.heading}>
        {amount(quote.amountIn, leg.config.tokenA.decimals)} {leg.config.tokenA.symbol}
      </Text>
      <Text color={UI.muted}> → </Text>
      <Text color={UI.heading}>{weiish(quote.amountOut, leg.config.tokenB.decimals)}</Text>
      <Text color={UI.muted}> {leg.config.tokenB.symbol}</Text>
      {off !== null && (
        <Text color={off < 0 ? TERM.markout : TERM.boundary}> {signed(off)}bps</Text>
      )}
    </Box>
  );
}

export function LegColumn({ leg }: { leg: LegSnapshot }) {
  const { config, position, shift } = leg;
  const inventoryWeight = shift?.weightA ?? null;

  return (
    <Box flexDirection="column" width={WIDTH} paddingRight={1}>
      <Box>
        <Text color={UI.heading} bold>
          {config.label}
        </Text>
        <Text color={position?.active === true ? TERM.boundary : UI.rejection}>
          {position === null ? " ?" : position.active ? " ●" : " docked"}
        </Text>
      </Box>
      {/* Elided in the middle rather than truncated: the last four characters are what an operator
          checks an address against in an explorer, so a prefix alone identifies nothing. */}
      <Text color={UI.muted}>{`${config.app.slice(0, 10)}…${config.app.slice(-6)}`}</Text>

      {position === null ? (
        <Text color={UI.caveat}>no indexed position</Text>
      ) : (
        <Box>
          <Text color={UI.muted}>inv   </Text>
          <Text color={UI.heading}>
            {amount(position.balanceA, config.tokenA.decimals, 2)} {config.tokenA.symbol}
          </Text>
          <Text color={UI.muted}> / </Text>
          <Text color={UI.heading}>{weiish(position.balanceB, config.tokenB.decimals)}</Text>
          {inventoryWeight !== null && (
            <Text color={UI.muted}> {weightPercent(inventoryWeight)}%</Text>
          )}
        </Box>
      )}

      <ShiftRows leg={leg} />
      <SpreadRow leg={leg} />
      <QuoteRow leg={leg} />
      {/* Wrapped rather than truncated — this is the one line written for a reader who does not
          already know the policy, and half of it says nothing — but clamped to two rows, so the
          column's height does not depend on how much there was to say. */}
      <Text color={UI.muted}>{clampToRows(`why: ${why(leg)}`, WIDTH - 1, 2)}</Text>
      {leg.caveats.length > 0 && (
        <Text color={UI.caveat} wrap="truncate-end">
          ! {leg.caveats[0]}
          {leg.caveats.length > 1 ? ` (+${leg.caveats.length - 1} more)` : ""}
        </Text>
      )}
    </Box>
  );
}
