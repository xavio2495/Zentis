import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createStore } from "@zentis/console-data";
import { type Action, Actions } from "./components/Actions.js";
import { BookStrip } from "./components/BookStrip.js";
import { Feed } from "./components/Feed.js";
import { LegColumn } from "./components/LegColumn.js";
import { Divider } from "./components/Divider.js";
import { SimCard } from "./components/SimCard.js";
import { UI } from "./theme.js";

/**
 * The whole screen is a function of one snapshot.
 *
 * The store polls and the screen renders whatever the last complete poll produced, so no two panels
 * can be showing different moments: a book strip claiming one seq above three columns read seconds
 * apart would be asserting exactly the thing the project has to prove.
 */
export function App({ envFile }: { envFile: string | null }) {
  const { exit } = useApp();
  const store = useMemo(() => createStore(), []);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    store.start();
    // The reference's age advances between polls, and a screen whose age field only moved when the
    // network answered would understate how stale the quote it is showing has become.
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      store.stop();
      clearInterval(tick);
    };
  }, [store]);

  const unsigned = envFile === null ? "no ZENTIS_ENV file was given, so this cannot sign" : null;
  const actions: Action[] = [
    { key: "r", label: "republish fast", disabledReason: unsigned },
    { key: "s", label: "republish slow", disabledReason: unsigned },
    { key: "f", label: "fill sepolia", disabledReason: unsigned },
    { key: "q", label: "re-quote", disabledReason: null },
  ];

  useInput((input) => {
    if (input === "x") exit();
    if (input === "q") void store.refresh();
  });

  const snapshot = state.snapshot;
  if (snapshot === null) {
    return (
      <Box borderStyle="round" borderColor={UI.frame} paddingX={1}>
        <Text color={UI.muted}>
          {state.error === null ? "reading three chains, three subgraphs and the quote service…" : state.error}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={UI.frame} paddingX={1} width={120}>
      <BookStrip snapshot={snapshot} nowSeconds={now} />
      <Divider label="legs" />
      <Box>
        {snapshot.legs.map((leg) => (
          <LegColumn key={leg.config.chainId} leg={leg} />
        ))}
      </Box>
      <Feed snapshot={snapshot} rows={8} />
      <SimCard report={snapshot.sim} />
      <Actions
        snapshot={snapshot}
        actions={actions}
        running={null}
        lastResult={state.loading ? "refreshing…" : null}
      />
      {snapshot.caveats.map((caveat, i) => (
        <Text key={i} color={UI.caveat} wrap="truncate-end">
          ! {caveat}
        </Text>
      ))}
    </Box>
  );
}
