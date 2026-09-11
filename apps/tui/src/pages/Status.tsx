import { Box, Text } from "ink";
import { type Snapshot, humanDuration, providersOf } from "@zentis/console-data";
import type { PublisherMode } from "../actions.js";
import { type Seg, padRows, trunc } from "../layout.js";
import { Segments } from "../components/Segments.js";
import { DOT, dotColour } from "../components/Providers.js";
import { UI } from "../theme.js";
import { type Column, columns } from "./table.js";

/**
 * Every source the console reads, and everything it has to say about itself.
 *
 * The live view carries one mark per source, which answers "is anything wrong". This answers the
 * next question: which one, what it last said, how old that is, how often it is asked, what it has
 * left of its allowance and when that window reopens. An operator looking at a number that seems
 * wrong comes here, and nothing else on the screen has to carry an endpoint's excuse.
 */
const STATE_WORD = { up: "answering", stale: "last-good", down: "down" } as const;

export function Status({
  snapshot,
  publisher,
  width,
  height,
}: {
  snapshot: Snapshot;
  /** which publisher this console can reach, which is what decides whether `r` and `s` exist */
  publisher: PublisherMode;
  width: number;
  height: number;
}) {
  const providers = providersOf(snapshot);
  const now = snapshot.takenAtSeconds;

  const cols: Column[] = [
    {
      header: "",
      cells: providers.map((p) => [{ text: DOT[p.state], color: dotColour(p.state) }]),
    },
    { header: "source", cells: providers.map((p) => [{ text: p.name, color: UI.heading }]) },
    {
      header: "state",
      cells: providers.map((p) => [
        { text: STATE_WORD[p.state], color: p.state === "up" ? UI.fill : p.state === "stale" ? UI.caveat : UI.rejection },
      ]),
    },
    {
      header: "last answer",
      cells: providers.map((p) => [{ text: p.detail ?? "—", color: UI.muted }]),
    },
    {
      header: "asked",
      optional: true,
      align: "right",
      // Zero is not "never": it is every poll, which is what the store does with a source that costs
      // nothing to read.
      cells: providers.map((p) => [
        { text: p.cadenceSeconds === 0 ? "each poll" : `every ${p.cadenceSeconds}s`, color: UI.muted },
      ]),
    },
    {
      header: "allowance",
      optional: true,
      align: "right",
      cells: providers.map((p) => {
        if (p.quota === null) return [{ text: "—", color: UI.muted }];
        const resets = p.quota.resetsAtSeconds > now ? `, ${humanDuration(p.quota.resetsAtSeconds - now)}` : "";
        return [
          { text: `${p.quota.remaining} left`, color: p.quota.remaining === 0 ? UI.rejection : UI.muted },
          { text: resets, color: UI.muted },
        ];
      }),
    },
  ];

  const table = columns(cols, width, providers.length);
  const rows: React.ReactNode[] = [
    <Segments key="head" segs={table.header} />,
    ...table.rows.map((segs, i) => <Segments key={`row${i}`} segs={segs} />),
  ];

  // What a source said when it refused, under the table rather than squeezed into a column: this is
  // the one place on the console where an endpoint's own words belong.
  const said = providers.filter((p) => p.reason !== null);
  if (said.length > 0) {
    rows.push(<Text key="sp"> </Text>);
    for (const [i, p] of said.entries()) {
      // The reset time is said once, at the end, where it reads as the thing to wait for: the
      // endpoint's own message carries it too, and twice on one row is twice to read.
      const reason = p.resetsAt === null ? p.reason! : p.reason!.replace(/,? resets \S+$/, "");
      const reset = p.resetsAt === null ? "" : `  · window reopens ${p.resetsAt}`;
      rows.push(
        <Segments
          key={`said${i}`}
          segs={[
            { text: `${p.name}: `, color: UI.muted },
            { text: reason, color: UI.caveat },
            { text: reset, color: UI.muted },
          ] satisfies Seg[]}
        />,
      );
    }
  }

  // Which publisher this console is on, said once and here: it is the reason `r` and `s` are on the
  // keys row or absent from it, and a reader who wonders where they went should find the answer.
  const PUBLISHER_WORDS: Record<PublisherMode, string> = {
    cloud: "cloud — the Cloud Run job, asked to run ahead of its own five-minute tick",
    local: "local — cre run from this checkout, with the key in ZENTIS_ENV",
    none: "none — the workflows run on their own; republishing is not offered here",
  };
  rows.push(<Text key="sp3"> </Text>);
  rows.push(
    <Segments
      key="publisher"
      segs={[
        { text: "publisher  ", color: UI.muted },
        { text: PUBLISHER_WORDS[publisher], color: publisher === "none" ? UI.muted : UI.heading },
      ]}
    />,
  );

  const polled = snapshot.takenAtSeconds;
  rows.push(<Text key="sp2"> </Text>);
  rows.push(
    <Text key="taken" color={UI.muted}>
      {trunc(`this reading was taken ${humanDuration(Math.max(0, Math.floor(Date.now() / 1000) - polled))} ago`, width)}
    </Text>,
  );

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {padRows(rows, height, null).map((row, i) => (
        <Box key={i} height={1}>
          {row ?? <Text> </Text>}
        </Box>
      ))}
    </Box>
  );
}
