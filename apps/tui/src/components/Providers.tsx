import { Box, Text } from "ink";
import { type Provider, type ProviderState, type Snapshot, providersOf } from "@zentis/console-data";
import { type Seg, fitSegments } from "../layout.js";
import { Segments } from "./Segments.js";
import { UI } from "../theme.js";

/**
 * One mark per source, on one row.
 *
 * It was a line each, which at a hundred and ninety columns took most of a panel whose subject is
 * the book. What a reader needs at a glance is whether anything is wrong, and that is a colour: green
 * answering, yellow serving its last good value, red down. What is wrong, what it said and when its
 * window reopens is a page of its own on `d`.
 *
 * The order is fixed — the chains in the cards' order, then the services, then the references — so
 * the same dot means the same source every time and a reader learns the row's shape rather than
 * reading it.
 */
export const DOT = { up: "●", stale: "◐", down: "▲" } as const;

export const dotColour = (state: ProviderState): string =>
  state === "up" ? UI.fill : state === "stale" ? UI.caveat : UI.rejection;

export function providerDots(providers: Provider[], width: number): Seg[] {
  const marks: Seg[] = providers.flatMap((p, i) => [
    ...(i === 0 ? [] : [{ text: " " }]),
    { text: DOT[p.state], color: dotColour(p.state) },
  ]);
  // Grouped by kind, because the per-chain ones repeat their chain's name and "sepolia ● sepolia"
  // says nothing about which of the two is which. Three dots under "rpc" are the three chains, in
  // the cards' order, every time.
  const GROUPS: [string, Provider["kind"][]][] = [
    ["rpc", ["rpc"]],
    ["fills", ["fills"]],
    ["quotes", ["quotes"]],
    ["mark", ["mark"]],
    ["market", ["market"]],
    ["refs", ["reference"]],
  ];
  const labelled: Seg[] = GROUPS.flatMap(([label, kinds], i): Seg[] => {
    const group = providers.filter((p) => kinds.includes(p.kind));
    if (group.length === 0) return [];
    return [
      ...(i === 0 ? [] : [{ text: "  " }]),
      { text: `${label} `, color: UI.muted },
      ...group.map((p) => ({ text: DOT[p.state], color: dotColour(p.state) })),
    ];
  });
  const down = providers.filter((p) => p.state === "down");
  const stale = providers.filter((p) => p.state === "stale");
  const said: Seg[] =
    down.length > 0
      ? [{ text: `  ${down.length} down · d`, color: UI.rejection }]
      : stale.length > 0
        ? [{ text: `  ${stale.length} on last-good · d`, color: UI.caveat }]
        : [{ text: "  all answering · d", color: UI.muted }];

  return fitSegments([[...labelled, ...said], [...marks, ...said], marks], width);
}

export function Providers({ snapshot, width }: { snapshot: Snapshot; width: number }) {
  return (
    <Box width={width} height={1} overflow="hidden">
      <Segments segs={providerDots(providersOf(snapshot), width)} />
    </Box>
  );
}
