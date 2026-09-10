import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { type Store, createStore } from "@zentis/console-data";
import type { Action } from "./action-types.js";
import { Feed } from "./components/Feed.js";
import { Graphs } from "./components/Graphs.js";
import { Help } from "./components/Help.js";
import { LegCard } from "./components/LegCard.js";
import { LegDetail } from "./components/LegDetail.js";
import { Panel, panelInner } from "./components/Panel.js";
import { StatusBar } from "./components/StatusBar.js";
import { type Pending, landed } from "./landed.js";
import { pairPrice } from "./format.js";
import { MIN_COLS, MIN_ROWS, fit, useSize } from "./layout.js";
import { resolve } from "./keymap.js";
import { LEG_ORDER, UI, legColour } from "./theme.js";
import { WINDOWS, autoWindow } from "./window.js";

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
/** Fifteen seconds a leg, as asked: long enough to read a line, short enough to see all three. */
export const ROTATE_MS = 15_000;

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
  // Which leg the chart region is showing while it rotates. Separate from `legIndex`, which is the
  // leg whose detail is pinned, so returning from a detail does not jerk the rotation somewhere else.
  const [shown, setShown] = useState(0);
  // Bumped by a manual step so the rotation timer restarts from it: a chart the operator just chose
  // should not be carried off a second later because the clock happened to be about to fire.
  const [stepped, setStepped] = useState(0);
  // Which window the charts use: an index into WINDOWS, or null for automatic — the shortest window
  // that still contains the leg's last fill, so the beat is never a single column at the edge.
  const [windowChoice, setWindowChoice] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [transient, setTransient] = useState<{ text: string; quiet: boolean } | null>(null);
  const say = (text: string, quiet = false) => setTransient({ text, quiet });
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

  // Fifteen seconds a leg. One chart at the region's full height reads; three stacked in a third of
  // it each do not. The rotation pauses whenever something is pinned, so reading a leg's detail is
  // never interrupted by the carousel moving on underneath it.
  useEffect(() => {
    if (overlay !== "none") return undefined;
    const timer = setInterval(() => setShown((current) => current + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [overlay, stepped]);

  const snapshot = state.snapshot;
  // Read every render; the one-second tick above is what makes "polled 12s ago" count up.
  const now = Math.floor(Date.now() / 1000);
  const armed = actions.some((a) => a.disabledReason === null && a.command !== null);

  const landing = running === null ? landed(awaiting, snapshot?.seq ?? null) : null;
  useEffect(() => {
    if (landing === null) return;
    say(landing);
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
        say(`${action.label} cancelled`, true);
        return;
      }
      setRunning(action.label);
      say(`running ${action.label}…`);
      setAwaiting({ label: action.label, seqBefore: snapshot?.seq ?? null });
      void runAction(action)
        .then((line) => say(line))
        .catch((cause: unknown) => say(`${action.label} could not start: ${String(cause)}`))
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
      case "window":
        setWindowChoice((current) => (current === null ? 0 : current + 1 >= WINDOWS.length ? null : current + 1));
        return;
      case "step": {
        const count = Math.max(1, snapshot?.legs.length ?? 1);
        setShown((current) => (current + (key.leftArrow ? count - 1 : 1)) % count);
        setStepped((n) => n + 1);
        return;
      }
      case "leg": {
        const picked = Number(input) - 1;
        setLegIndex(picked);
        setShown(picked);
        // Pressing a leg's number twice returns to the rotation, so the same key that opened a
        // detail closes it and `esc` is a convenience rather than the only way out.
        setOverlay((current) => (current === "leg" && legIndex === picked ? "none" : "leg"));
        return;
      }
      default: {
        if (running !== null) return;
        const action = actions.find((a) => a.key === input);
        if (action === undefined) return;
        if (action.disabledReason !== null) {
          // Watch-only is a choice, not a fault, so pressing a signing key there gets a quiet note
          // pointing at the help overlay. A missing repository is something the operator can fix,
          // so its reason is said in full.
          if (action.blocker === "env") say(`${action.label} is off in watch-only · ? says how to arm it`, true);
          else say(action.disabledReason);
          return;
        }
        setConfirming(action);
        // The key comes first: this line is truncated to the status bar's width, and a prompt whose
        // instruction falls off the end is a prompt that has not been given.
        say(`press y to broadcast — ${action.label}: ${action.describe}`);
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

  const rotating = ordered[shown % Math.max(1, ordered.length)] ?? ordered[0];
  const lastFillAt = (chainId: number): number | null => {
    const fills = snapshot.feed.filter((row) => row.kind === "fill" && row.chainId === chainId);
    return fills.length === 0 ? null : Math.max(...fills.map((row) => Number(row.timestamp)));
  };
  const windowFor = (chainId: number) =>
    windowChoice === null ? autoWindow(lastFillAt(chainId), snapshot.takenAtSeconds) : WINDOWS[windowChoice]!;
  const graphInner = panelInner(regions.rightWidth, regions.graphRows);

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
            windowSeconds={BigInt(windowFor(leg.config.chainId).seconds)}
          />
        ))}
      </Box>

      <Box flexDirection="column" width={regions.rightWidth} height={regions.draw} overflow="hidden">
        <Panel title="zentis" width={regions.rightWidth} height={regions.statusRows + 2}>
          <StatusBar
            snapshot={snapshot}
            actions={actions}
            armed={armed}
            rows={regions.statusRows}
            width={panelInner(regions.rightWidth, regions.statusRows + 2).width}
            transient={transient}
            polledAgo={state.lastPollSeconds === null ? null : Math.max(0, now - state.lastPollSeconds)}
            loading={state.loading}
          />
        </Panel>

        {regions.graphRows > 0 &&
          (overlay === "help" ? (
            <Panel
              title="help"
              right="esc or ? to close"
              width={regions.rightWidth}
              height={regions.graphRows + regions.feedRows}
            >
              <Help
                report={snapshot.sim}
                actions={actions}
                {...panelInner(regions.rightWidth, regions.graphRows + regions.feedRows)}
              />
            </Panel>
          ) : overlay === "leg" && selected !== undefined ? (
            <Panel
              title={`${legIndex + 1} ${selected.config.label}`}
              right="esc to close"
              width={regions.rightWidth}
              height={regions.graphRows}
              colour={legColour(selected.config.chainId)}
            >
              <LegDetail
                leg={selected}
                {...panelInner(regions.rightWidth, regions.graphRows)}
                windowSeconds={BigInt(windowFor(selected.config.chainId).seconds)}
              />
            </Panel>
          ) : rotating === undefined ? null : (
            <Panel
              title={
                `market price · ${rotating.config.label.split(" ")[0]}` +
                (rotating.series === null
                  ? ""
                  : ` · ${pairPrice(rotating.series.mid, rotating.config.tokenA, rotating.config.tokenB)}`)
              }
              right={`${windowFor(rotating.config.chainId).label} window${windowChoice === null ? " · auto" : ""} · t`}
              width={regions.rightWidth}
              height={regions.graphRows}
              colour={legColour(rotating.config.chainId)}
            >
              <Graphs
                leg={rotating}
                snapshot={snapshot}
                {...graphInner}
                windowSeconds={BigInt(windowFor(rotating.config.chainId).seconds)}
              />
            </Panel>
          ))}

        {overlay !== "help" && (
          <Panel title="feed" width={regions.rightWidth} height={regions.feedRows}>
            <Feed
              snapshot={snapshot}
              width={panelInner(regions.rightWidth, regions.feedRows).width}
              rows={panelInner(regions.rightWidth, regions.feedRows).height}
            />
          </Panel>
        )}
      </Box>
    </Box>
  );
}
