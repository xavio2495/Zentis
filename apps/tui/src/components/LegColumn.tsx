import { Box, Text } from "ink";
import { type LegSnapshot, offMidBps, weightPercent, why } from "@zentis/console-data";
import { chooseFit, clampToRows, duration, shiftRow, signed, spreadRow, stackedGauge, tokenAmount } from "../format.js";
import { TERM, UI } from "../theme.js";


/**
 * The spread's terms, each in its own colour.
 *
 * The widths come from `spreadRow`, which guarantees the row fits the column. That guarantee is the
 * point: asked to render something too wide, Ink drops characters out of the middle, and on a row of
 * numbers the result still looks like a decomposition while no longer summing to its own total.
 */
function SpreadRow({ leg, width }: { leg: LegSnapshot; width: number }) {
  const spread = leg.spread;
  if (spread === null) return <Text color={UI.muted}>spread —</Text>;
  const { note } = spreadRow(
    spread,
    leg.position?.widenBpsPerMinute ?? 0,
    Math.floor(spread.referenceAgeSeconds / 60),
    width,
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

function ShiftRows({ leg, width }: { leg: LegSnapshot; width: number }) {
  const shift = leg.shift;
  const ref = leg.ref;
  if (shift === null || ref === null) {
    return (
      <Box>
        <Text color={UI.muted}>shift </Text>
        <Text color={UI.heading}>{ref === null ? "\u2014" : signed(ref.tiltBps)}</Text>
        <Text color={UI.caveat}> (not decomposed)</Text>
      </Box>
    );
  }

  const gaugeWidth = Math.max(8, Math.min(24, width - 8));
  const spans = stackedGauge(
    shift.correction,
    shift.concession,
    BigInt(leg.position?.maxTiltBps ?? 500),
    gaugeWidth,
  );
  const room = shift.roomUnknownAtCap ? "?" : String(shift.roomBps);

  return (
    <Box flexDirection="column">
      {/* Built as one fitted string rather than coloured pieces: the pieces are what Ink squeezes,
          and a squeezed tilt is a smaller tilt that still looks like one. */}
      <Text color={UI.muted} wrap="truncate-end">
        {shiftRow(shift.tiltBps, shift.correction, shift.concession, shift.clampedByMaxTilt, width)}
      </Text>
      <Box>
        <Text color={UI.frame}>{"      \u2595"}</Text>
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
        <Text color={UI.frame}>{"\u258f"}</Text>
      </Box>
      <Box>
        {/* A leg at its shift cap publishes a boundary equal to the cap, so the room cannot be
            recovered. Printing the zero it arithmetically comes to would assert a budget of none. */}
        <Text color={UI.muted}>room </Text>
        <Text color={shift.roomUnknownAtCap ? UI.caveat : TERM.boundary}>{room}</Text>
        <Text color={UI.muted}>{" of "}</Text>
        <Text color={TERM.boundary}>{ref.bandEdgeBps}</Text>
        <Text color={TERM.bookConcession} wrap="truncate-end">
          {`  book ${signed(shift.bookConcession)}`}
        </Text>
      </Box>
    </Box>
  );
}

function QuoteRow({ leg, width }: { leg: LegSnapshot; width: number }) {
  const quote = leg.quoteAToB;
  if (quote?.amountOut == null) {
    return (
      <Text color={UI.muted} wrap="truncate-end">
        {chooseFit(
          ["quote — the router would not price this leg", "quote — not priced", "quote —"],
          width,
        )}
      </Text>
    );
  }
  const off = offMidBps(quote, true);
  const inAmount = `${tokenAmount(quote.amountIn, leg.config.tokenA.decimals)} ${leg.config.tokenA.symbol}`;
  const outAmount = `${tokenAmount(quote.amountOut, leg.config.tokenB.decimals)} ${leg.config.tokenB.symbol}`;
  const away = off === null ? "" : ` ${signed(off)}bps`;
  return (
    <Text color={off !== null && off < 0 ? TERM.markout : UI.heading} wrap="truncate-end">
      {chooseFit(
        [`${inAmount} → ${outAmount}${away}`, `${inAmount} → ${outAmount}`, outAmount],
        width,
      )}
    </Text>
  );
}

export function LegColumn({ leg, width }: { leg: LegSnapshot; width: number }) {
  const inner = width - 1; // one column of gutter between legs
  const { config, position, shift } = leg;
  const inventoryWeight = shift?.weightA ?? null;

  return (
    <Box flexDirection="column" width={width} paddingRight={1}>
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
      <Text color={UI.muted} wrap="truncate-end">{`${config.app.slice(0, 10)}…${config.app.slice(-6)}`}</Text>

      {position === null ? (
        <Text color={UI.caveat}>no indexed position</Text>
      ) : (
        <Text color={UI.muted} wrap="truncate-end">
          {chooseFit(
            [
              `inv ${tokenAmount(position.balanceA, config.tokenA.decimals)} ${config.tokenA.symbol} / ` +
                `${tokenAmount(position.balanceB, config.tokenB.decimals)} ${config.tokenB.symbol}` +
                (inventoryWeight === null ? "" : `  ${weightPercent(inventoryWeight)}%`),
              `inv ${tokenAmount(position.balanceA, config.tokenA.decimals)} / ` +
                `${tokenAmount(position.balanceB, config.tokenB.decimals)}` +
                (inventoryWeight === null ? "" : ` ${weightPercent(inventoryWeight)}%`),
              inventoryWeight === null ? "inv" : `inv ${weightPercent(inventoryWeight)}%`,
            ],
            inner,
          )}
        </Text>
      )}

      <ShiftRows leg={leg} width={inner} />
      <SpreadRow leg={leg} width={inner} />
      <QuoteRow leg={leg} width={inner} />
      {/* Wrapped rather than truncated — this is the one line written for a reader who does not
          already know the policy, and half of it says nothing — but clamped to two rows, so the
          column's height does not depend on how much there was to say. */}
      <Text color={UI.muted}>{clampToRows(`why: ${why(leg)}`, inner, 2)}</Text>
      {leg.caveats.length > 0 && (
        <Text color={UI.caveat} wrap="truncate-end">
          ! {leg.caveats[0]}
          {leg.caveats.length > 1 ? ` (+${leg.caveats.length - 1} more)` : ""}
        </Text>
      )}
    </Box>
  );
}
