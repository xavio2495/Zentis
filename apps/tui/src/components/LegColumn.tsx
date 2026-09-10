import { Box, Text } from "ink";
import { type LegSnapshot, offMidBps, weightPercent, why } from "@zentis/console-data";
import { amount, signed, since, stackedGauge, weiish } from "../format.js";
import { TERM, UI } from "../theme.js";

const WIDTH = 38;

/** The three terms of the spread, drawn as one bar so their proportions are readable, not just their sums. */
function SpreadRow({ leg }: { leg: LegSnapshot }) {
  const spread = leg.spread;
  if (spread === null) return <Text color={UI.muted}>spread —</Text>;
  return (
    <Box>
      <Text color={UI.muted}>spread </Text>
      <Text color={UI.heading}>{String(spread.totalBps).padEnd(4)}</Text>
      <Text color={TERM.base}>{spread.baseBps}</Text>
      <Text color={UI.muted}>+</Text>
      <Text color={TERM.volatility}>{spread.volatilityBps}</Text>
      <Text color={UI.muted}>+</Text>
      <Text color={TERM.markout}>{spread.markoutBps}</Text>
      <Text color={UI.muted}>+</Text>
      <Text color={TERM.staleness}>{spread.stalenessBps}</Text>
      <Text color={UI.muted}> ({since(spread.referenceAgeSeconds)})</Text>
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
        <Text color={TERM.boundary}>{String(shift.roomBps).padEnd(6)}</Text>
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
      {/* Allowed to wrap rather than truncated: this is the one line on the screen written for a
          reader who does not already know the policy, and half of it says nothing. */}
      <Text color={UI.muted}>why: {why(leg)}</Text>
      {leg.caveats.slice(0, 2).map((caveat, i) => (
        <Text key={i} color={UI.caveat} wrap="truncate-end">
          ! {caveat}
        </Text>
      ))}
    </Box>
  );
}
