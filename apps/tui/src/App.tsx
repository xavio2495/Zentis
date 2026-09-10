import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createStore } from "@zentis/console-data";
import { Actions } from "./components/Actions.js";
import { buildActions } from "./actions.js";
import { run, summarise } from "./runner.js";
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

  const actions = useMemo(() => buildActions(envFile), [envFile]);
  const [running, setRunning] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useInput((input) => {
    if (input === "x") {
      exit();
      return;
    }
    if (running !== null) return;

    // An action that has been offered for confirmation consumes the next keystroke, so that the
    // key which broadcasts is never the same key that was pressed to ask about broadcasting.
    if (pending !== null) {
      const action = actions.find((a) => a.key === pending);
      setPending(null);
      if (input !== "y" || action?.command == null) {
        setLastResult(`${action?.label ?? "action"} cancelled`);
        return;
      }
      setRunning(action.label);
      void run(action.command)
        .then((result) => setLastResult(summarise(action, result)))
        .catch((cause: unknown) => setLastResult(`${action.label} could not start: ${String(cause)}`))
        .finally(() => {
          setRunning(null);
          void store.refresh();
        });
      return;
    }

    const action = actions.find((a) => a.key === input);
    if (action === undefined) return;
    if (action.disabledReason !== null) {
      setLastResult(action.disabledReason);
      return;
    }
    // Re-quote reads and is therefore immediate. Everything else signs and broadcasts, and a
    // console that did that on one keystroke would broadcast every time a key was brushed.
    if (action.command === null) {
      void store.refresh();
      return;
    }
    setPending(action.key);
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
      <Feed snapshot={snapshot} />
      <SimCard report={snapshot.sim} />
      <Actions
        snapshot={snapshot}
        actions={actions}
        running={running}
        pending={pending === null ? null : (actions.find((a) => a.key === pending) ?? null)}
        lastResult={lastResult ?? (state.loading ? "refreshing…" : null)}
      />
      {snapshot.caveats.map((caveat, i) => (
        <Text key={i} color={UI.caveat} wrap="truncate-end">
          ! {caveat}
        </Text>
      ))}
    </Box>
  );
}
