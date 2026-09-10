import { QUOTE_SIZE_A, takeSnapshot } from "../src/snapshot.js";
import { weightPercent } from "../src/decompose.js";
import { headline } from "../src/sim.js";

/**
 * The data layer with no screen in front of it. Everything the TUI will draw has to be true here
 * first, so this is what gets read when a column looks wrong: if the number is wrong here it is a
 * reader, and if it is right here it is the render.
 */
const snapshot = await takeSnapshot(QUOTE_SIZE_A);

console.log(
  `${snapshot.pair} · ${snapshot.legs.length} legs · seq ${snapshot.seq ?? "(split)"} · ` +
    `book ${weightPercent(snapshot.bookWeightA)}% ${snapshot.legs[0]!.config.tokenA.symbol}`,
);
console.log(`gains assumed: own ${snapshot.gains.kappaOwnBps}, book ${snapshot.gains.kappaBookBps} — ${snapshot.gains.source}\n`);

for (const leg of snapshot.legs) {
  const { config, ref, shift, spread } = leg;
  console.log(`${config.label} (${config.chainId})`);
  if (ref === null) {
    console.log(`  no reference: ${leg.caveats.join("; ")}`);
    continue;
  }
  console.log(`  reference  mid ${ref.mid} · seq ${ref.seq} · shift ${ref.tiltBps} · boundary ${ref.bandEdgeBps}`);
  if (shift !== null) {
    console.log(
      `  shift      ${shift.tiltBps} = correction ${shift.correction} + concession ${shift.concession}` +
        `   (own ${shift.ownConcession}, book ${shift.bookConcession}, room ${shift.roomBps})`,
    );
    console.log(`  agrees with the enclave: ${shift.agrees}`);
  }
  if (spread !== null) {
    console.log(
      `  spread     ${spread.totalBps} = base ${spread.baseBps} + vol ${spread.volatilityBps} + markout ${spread.markoutBps}` +
        ` + staleness ${spread.stalenessBps}   (ref ${spread.referenceAgeSeconds}s old; console recomputes vol ${spread.recomputedVolatilityBps})`,
    );
  }
  const quote = leg.quoteAToB;
  if (quote?.amountOut != null) {
    console.log(`  quote      ${quote.amountIn} ${config.tokenA.symbol} -> ${quote.amountOut} ${config.tokenB.symbol}`);
  }
  if (leg.finality !== null) {
    console.log(`  finality   head ${leg.finality.head}, finalized ${leg.finality.finalized}`);
  }
  for (const caveat of leg.caveats) console.log(`  caveat     ${caveat}`);
}

console.log(`\nfeed (${snapshot.feed.length} events, newest first)`);
for (const event of snapshot.feed.slice(0, 8)) {
  const when = new Date(Number(event.timestamp) * 1000).toISOString().slice(11, 19);
  const what =
    event.kind === "fill"
      ? `fill ${event.amountIn} -> ${event.amountOut} at shift ${event.refTiltBps}`
      : event.kind === "reference"
        ? `reference seq ${event.seq} shift ${event.tiltBps}`
        : `rejected: ${event.reason}`;
  console.log(`  ${when} ${String(event.chainId).padEnd(9)} ${what}`);
}

console.log(`\nsimulation: ${headline(snapshot.sim)} — model ${snapshot.sim.modelCommit.slice(0, 10)}`);
for (const caveat of snapshot.caveats) console.log(`caveat: ${caveat}`);
