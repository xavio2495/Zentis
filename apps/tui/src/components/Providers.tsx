import { Box, Text } from "ink";
import { type Provider, type Snapshot, providersOf } from "@zentis/console-data";
import { type Seg, fitSegments, padRows } from "../layout.js";
import { Segments } from "./Segments.js";
import { UI } from "../theme.js";

/**
 * One line per source, or as close to that as the terminal allows.
 *
 * Eleven endpoints across three chains, and before this panel a failure in any of them arrived as a
 * sentence somewhere else on the screen — inside a card, inside the feed, under the status bar — so
 * a reader could not tell which sources were answering without reading everything and inferring it.
 *
 * At a tall terminal each source gets its row. At a short one they collapse into marks, with the
 * ones that are down named: a reader who can see nothing else must still see what is not answering.
 * The long explanation of any of it lives in help.
 */
const DOT = { up: "●", down: "▲" } as const;

function line(provider: Provider, width: number): Seg[] {
  const tone = provider.ok ? UI.fill : UI.rejection;
  const state: Seg = { text: `${provider.ok ? DOT.up : DOT.down} `, color: tone };
  const name: Seg = { text: provider.name.padEnd(16), color: UI.muted };
  const said: Seg = provider.ok
    ? { text: provider.detail ?? "", color: UI.muted }
    : { text: provider.reason ?? "down", color: UI.caveat };
  return fitSegments(
    [
      [state, name, said],
      [state, { text: `${provider.name} `, color: UI.muted }, said],
      [state, { text: provider.name, color: UI.muted }],
    ],
    width,
  );
}

/** Every source as one row of marks, with the failing ones named after them. */
function marks(providers: Provider[], width: number): Seg[] {
  const chips: Seg[] = providers.map((p) => ({ text: p.ok ? DOT.up : DOT.down, color: p.ok ? UI.fill : UI.rejection }));
  const down = providers.filter((p) => !p.ok);
  const named: Seg[] =
    down.length === 0
      ? [{ text: "  all sources answering", color: UI.muted }]
      : [{ text: `  ${down.map((p) => p.name).join(", ")} down`, color: UI.caveat }];
  return fitSegments(
    [
      [...chips, ...named],
      [...chips, { text: down.length === 0 ? "  all up" : `  ${down.length} down`, color: down.length === 0 ? UI.muted : UI.caveat }],
      chips,
    ],
    width,
  );
}

export function Providers({
  snapshot,
  width,
  rows,
}: {
  snapshot: Snapshot;
  width: number;
  /** how many rows this panel may use for sources, after the book's own row */
  rows: number;
}) {
  const providers = providersOf(snapshot);
  if (rows <= 0) return null;
  // One row each when they all fit; otherwise the marks, which say the same thing in one row for a
  // reader who only needs to know whether anything is wrong.
  const each = rows >= providers.length;
  const drawn = each ? providers.map((p) => line(p, width)) : [marks(providers, width)];

  return (
    <Box flexDirection="column" width={width} height={rows} overflow="hidden">
      {padRows(
        drawn.map((segs, i) => <Segments key={i} segs={segs} />),
        rows,
        null,
      ).map((row, i) => (
        <Box key={i} height={1}>
          {row ?? <Text> </Text>}
        </Box>
      ))}
    </Box>
  );
}
