import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BOOK, type Store, createStore } from "@zentis/console-data";
import type { Action } from "./action-types.js";
import { Feed } from "./components/Feed.js";
import { Graphs } from "./components/Graphs.js";
import { Help } from "./components/Help.js";
import { LegCard } from "./components/LegCard.js";
import { LegDetail } from "./components/LegDetail.js";
import { StatusBar } from "./components/StatusBar.js";
import { type Pending, landed } from "./landed.js";
import { MIN_COLS, MIN_ROWS, fit, useSize } from "./layout.js";
import { resolve } from "./keymap.js";
import { LEG_ORDER, UI } from "./theme.js";

/**
 * The console: three leg cards down the left, a status bar, the reference-pool charts and the feed
 * down the right.
 *
 * Everything comes from one snapshot, so no two regions can be describing different moments — a
 * status bar claiming one seq above three cards read seconds apart would be asserting exactly the
 * thing this project has to prove.
 *
 * Every region is given an explicit height and clipped. Shedding rows in `fit` is not on its own
 * the guarantee: a region that draws one row more than it was budgeted pushes the frame to
 * `stdout.rows`, and Ink then clears the whole terminal on every frame. Clipping is the guarantee.
 */
export function App({
  actions,
  runAction,
  makeStore = createStore,
}: {
  actions: Action[];
  /** resolves to the line the status bar should show once the command has finished */
  runAction: ((action: Action) => Promise<string>) | null;
  /**
   * The store, injectable so the sandbox can drive this exact component against a fixed snapshot.
   * ESM exports are read-only, so patching the module is not available; a defaulted prop keeps the
   * shipped path identical rather than giving the sandbox a different app to test.
   */
  makeStore?: () => Store;
}) {
  const { exit } = useApp();
  const size = useSize();
  const store = useMemo(() => makeStore(), [makeStore]);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [, setTick] = useState(0);

  const [overlay, setOverlay] = useState<"none" | "leg" | "help">("none");
  const [legIndex, setLegIndex] = useState(0);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [transient, setTransient] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState<Pending | null>(null);

  useEffect(() => {
    store.start();
    // The reference's age advances between polls, and an age that only moved when the network
    // answered would understate how stale the quote on screen has become.
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      store.stop();
      clearInterval(timer);
    };
  }, [store]);

  const snapshot = state.snapshot;
  const armed = actions.some((a) => a.disabledReason === null && a.command !== null);

  const landing = running === null ? landed(awaiting, snapshot?.seq ?? null) : null;
  useEffect(() => {
    if (landing === null) return;
    setTransient(landing);
    setAwaiting(null);
  }, [landing]);

  useInput((input, key) => {
    const binding = resolve({ confirming: confirming !== null, overlay }, input, key);

    // A pending confirmation consumes the next keystroke whatever it is, so the key that broadcasts
    // is never the key that was pressed to ask about broadcasting.
    if (confirming !== null) {
      const action = confirming;
      setConfirming(null);
      if (binding?.id !== "confirm" || action.command === null || runAction === null) {
        setTransient(`${action.label} cancelled`);
        return;
      }
      setRunning(action.label);
      setTransient(`running ${action.label}…`);
      setAwaiting({ label: action.label, seqBefore: snapshot?.seq ?? null });
      void runAction(action)
        .then(setTransient)
        .catch((cause: unknown) => setTransient(`${action.label} could not start: ${String(cause)}`))
        .finally(() => {
          setRunning(null);
          void store.refresh(true);
        });
      return;
    }

    if (binding === null) return;
    switch (binding.id) {
      case "quit":
        exit();
        return;
      case "help":
        setOverlay((current) => (current === "help" ? "none" : "help"));
        return;
      case "back":
        setOverlay("none");
        return;
      case "quote":
        void store.refresh(true);
        return;
      case "leg":
        setLegIndex(Number(input) - 1);
        setOverlay("leg");
        return;
      default: {
        if (running !== null) return;
        const action = actions.find((a) => a.key === input);
        if (action === undefined) return;
        if (action.disabledReason !== null) {
          setTransient(action.disabledReason);
          return;
        }
        setConfirming(action);
        // The key comes first: this line is truncated to the status bar's width, and a prompt whose
        // instruction falls off the end is a prompt that has not been given.
        setTransient(`press y to broadcast — ${action.label}: ${action.describe}`);
      }
    }
  });

  if (size.tooSmall) {
    return (
      <Text color={UI.caveat}>
        {`the console needs at least ${MIN_COLS}×${MIN_ROWS}; this terminal is ${size.cols}×${size.rows}`}
      </Text>
    );
  }

  const regions = fit(size.cols, size.rows);

  if (snapshot === null) {
    return (
      <Box width={regions.legsWidth + regions.rightWidth} height={regions.draw} overflow="hidden">
        <Text color={UI.muted}>
          {state.error ?? "reading three chains, three subgraphs and the quote service…"}
        </Text>
      </Box>
    );
  }

  // The wireframe's order, which is not the data layer's: the display owns how the legs are stacked.
  const ordered = LEG_ORDER.map((chainId) =>
    snapshot.legs.find((leg) => leg.config.chainId === chainId),
  ).filter((leg): leg is NonNullable<typeof leg> => leg !== undefined);
  const selected = ordered[Math.min(legIndex, ordered.length - 1)];

  return (
    <Box height={regions.draw} overflow="hidden">
      <Box flexDirection="column" width={regions.legsWidth} height={regions.draw} overflow="hidden">
        {ordered.map((leg, i) => (
          <LegCard
            key={leg.config.chainId}
            leg={leg}
            index={i}
            width={regions.legsWidth}
            height={regions.cardHeights[i] ?? 0}
            selected={overlay === "leg" && i === legIndex}
          />
        ))}
      </Box>

      <Box flexDirection="column" width={regions.rightWidth} height={regions.draw} overflow="hidden">
        <StatusBar
          snapshot={snapshot}
          actions={actions}
          armed={armed}
          rows={regions.statusRows}
          width={regions.rightWidth}
          transient={transient}
        />
        {/* Help takes the whole right column below the status bar: it is the one place prose
            lives, and prose that has to be paginated at 40 rows is prose nobody reads. The leg
            detail stays in the chart region, so the feed underneath keeps running while you read
            it — the feed is how you watch a write land. */}
        {overlay === "help" ? (
          <Help
            report={snapshot.sim}
            width={regions.rightWidth}
            height={regions.graphRows + regions.feedRows}
          />
        ) : (
          <>
            {regions.graphRows > 0 &&
              (overlay === "leg" && selected !== undefined ? (
                <LegDetail leg={selected} width={regions.rightWidth} height={regions.graphRows} />
              ) : (
                <Graphs
                  snapshot={snapshot}
                  width={regions.rightWidth}
                  height={regions.graphRows}
                  windowSeconds={BigInt(BOOK.volatilityWindowSeconds)}
                />
              ))}
            <Feed snapshot={snapshot} width={regions.rightWidth} rows={regions.feedRows} />
          </>
        )}
      </Box>
    </Box>
  );
}
