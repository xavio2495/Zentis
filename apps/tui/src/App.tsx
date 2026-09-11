import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BOOK, LEGS, type LegConfig, type Store, createStore, fetchQuotes, offMidBps } from "@zentis/console-data";
import type { Action } from "./action-types.js";
import { Feed } from "./components/Feed.js";
import { Graphs, marketPrice } from "./components/Graphs.js";
import { Help } from "./components/Help.js";
import { LegCard } from "./components/LegCard.js";
import { LegDetail } from "./components/LegDetail.js";
import { CommandLine } from "./components/CommandLine.js";
import { Panel, panelInner } from "./components/Panel.js";
import { Pnl } from "./pages/Pnl.js";
import { Positions } from "./pages/Positions.js";
import { Simulation } from "./pages/Simulation.js";
import { WalletPage } from "./pages/WalletPage.js";
import { StatusBar } from "./components/StatusBar.js";
import { type Pending, landed } from "./landed.js";
import { chooseFit, pairPrice, tokenAmount } from "./format.js";
import { MIN_COLS, MIN_ROWS, fit, useSize } from "./layout.js";
import { type Command, parseCommand } from "./command.js";
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

/** What the chart asks for before the operator has chosen a window: the longest one. */
const MARKET_HOURS_DEFAULT = 168;

/** The pages, and the word the status bar names each one by. */
export type Page = "live" | "positions" | "pnl" | "wallet" | "simulation";
const PAGE_OF: Record<string, Page> = { positions: "positions", pnl: "pnl", wallet: "wallet", sim: "simulation" };

export function App({
  actions,
  runAction,
  makeStore = createStore,
  commands = null,
}: {
  actions: Action[];
  /**
   * How a typed command becomes an action, so `:fill base 0.3` and the `f` key produce the same
   * `Action`, ask the same confirmation and are refused in the same words. Null means the console
   * was given no way to sign, which the row says when a signing command is typed.
   */
  commands?: {
    fill: (fill: { leg: LegConfig; amountRaw: bigint; isAToB: boolean }) => Action;
    republish: (workflow: "fast" | "slow") => Action;
  } | null;
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
  // Which page the right-hand column is on. The cards and the overall view are on every one of them,
  // so a reader who walks away from the live view still sees the book move.
  const [page, setPage] = useState<Page>("live");
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
  // The command line: what is being typed, what the last one answered, and what has been typed
  // before. `null` is closed — the row only exists while it has the keyboard.
  const [typing, setTyping] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ text: string; bad: boolean } | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [recalled, setRecalled] = useState(0);

  // The window the chart is drawing, asked of the service rather than cut from a week here: a short
  // window comes back per swap, and an hour of hourly closes is two points and a straight line.
  // Automatic asks for the longest, which is the series every shorter one is a cut of anyway.
  const marketHours =
    windowChoice === null
      ? MARKET_HOURS_DEFAULT
      : Math.max(1, Math.round((WINDOWS[windowChoice]?.seconds ?? 0) / 3600));
  useEffect(() => {
    store.setMarketHours(marketHours);
  }, [store, marketHours]);

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

  /** What a quote reads as on the command row: what went in, what came back, and how far off the mid. */
  const quoteLine = (leg: LegConfig, side: "AtoB" | "BtoA", amountRaw: bigint): Promise<string> =>
    fetchQuotes(BOOK.positionId, amountRaw, side).then((read) => {
      const quote = read.value?.quotes.find((q) => q.chainId === leg.chainId);
      if (quote === undefined) return `${leg.name}: ${read.error ?? "the quote service said nothing about this leg"}`;
      const [from, to] = side === "AtoB" ? [leg.tokenA, leg.tokenB] : [leg.tokenB, leg.tokenA];
      if (quote.amountOut === null) {
        const why = quote.refusal?.sentence ?? quote.caveats[0] ?? "the router refused it";
        return `${leg.name} ${from.symbol} → ${to.symbol}: ${why}`;
      }
      const off = offMidBps(quote, side === "AtoB");
      return (
        `${leg.name} ${tokenAmount(amountRaw, from.decimals)} ${from.symbol} → ` +
        `${tokenAmount(quote.amountOut, to.decimals)} ${to.symbol}` +
        (off === null ? "" : ` · ${off > 0 ? "+" : ""}${off} bps`)
      );
    });

  /**
   * Carry out a typed command.
   *
   * Navigation and the window are done here because they are the console's own state. A quote is a
   * read, so it runs watch-only. Anything that signs is handed to the same confirmation the keys
   * use — the command line is a way of naming an action, never a second way of performing one.
   */
  const runCommand = (command: Command) => {
    switch (command.kind) {
      case "page":
        setPage(command.page);
        setTyping(null);
        setAnswer(null);
        return;
      case "window":
        setWindowChoice(command.index);
        setAnswer({ text: `chart window ${command.index === null ? "automatic" : WINDOWS[command.index]!.label}`, bad: false });
        return;
      case "quote": {
        const sides: ("AtoB" | "BtoA")[] = command.side === "both" ? ["AtoB", "BtoA"] : [command.side];
        setAnswer({ text: "asking the router…", bad: false });
        void Promise.all(sides.map((side) => quoteLine(command.leg, side, command.amountRaw)))
          .then((lines) => setAnswer({ text: lines.join("   ·   "), bad: false }))
          .catch((cause: unknown) => setAnswer({ text: `the quote service could not be reached: ${String(cause)}`, bad: true }));
        return;
      }
      case "rebalance":
        // The panel is the answer to this question: it sizes the top-up from the leg's own reserves
        // against the mid, and says so for every leg at once.
        setPage("positions");
        setAnswer({ text: `${command.leg.name}'s rebalance is on the positions page`, bad: false });
        return;
      case "push":
        // Named, never run. A push moves the maker's own money, the script sizes it from the chain
        // rather than from anything on this screen, and the operator is the one who signs it.
        setAnswer({
          text: `run it yourself: python3 scripts/rebalance.py --only ${command.leg.name}  (--dry-run reads it first)`,
          bad: false,
        });
        return;
      case "fill":
      case "republish": {
        if (commands === null) {
          setAnswer({ text: "this console was given no way to sign, so it cannot run that", bad: true });
          return;
        }
        const action =
          command.kind === "fill"
            ? commands.fill({ leg: command.leg, amountRaw: command.amountRaw, isAToB: command.isAToB })
            : commands.republish(command.workflow);
        if (action.disabledReason !== null) {
          setAnswer({ text: action.disabledReason, bad: true });
          return;
        }
        // Off the row and into the same prompt a key would raise: one place decides what broadcasts.
        setTyping(null);
        setAnswer(null);
        setConfirming(action);
        say(`press y to broadcast — ${action.label}: ${action.describe}`);
      }
    }
  };

  useInput((input, key) => {
    // While the row is open it has the keyboard, so no keystroke meant for a command can also fire
    // the key it happens to share a letter with. A pending confirmation still outranks it.
    if (typing !== null && confirming === null) {
      if (key.escape) {
        setTyping(null);
        setAnswer(null);
        return;
      }
      if (key.return) {
        const line = typing.trim();
        if (line === "") return;
        setHistory((past) => [line, ...past.filter((p) => p !== line)]);
        setRecalled(0);
        const parsed = parseCommand(line, LEGS);
        if ("error" in parsed) {
          setAnswer({ text: parsed.error, bad: true });
          return;
        }
        setTyping("");
        runCommand(parsed.command);
        return;
      }
      if (key.upArrow || key.downArrow) {
        // Newest first, so one press of up is the command just typed.
        const next = Math.max(0, Math.min(history.length, recalled + (key.upArrow ? 1 : -1)));
        setRecalled(next);
        setTyping(next === 0 ? "" : (history[next - 1] ?? ""));
        return;
      }
      if (key.backspace || key.delete) {
        setTyping((current) => (current ?? "").slice(0, -1));
        return;
      }
      if (input !== "" && !key.ctrl && !key.meta) setTyping((current) => (current ?? "") + input);
      return;
    }

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
      case "live":
        setPage("live");
        return;
      case "positions":
      case "pnl":
      case "wallet":
      case "sim": {
        const wanted = PAGE_OF[binding.id]!;
        // The key that opened a page closes it, like a leg's number does, so no reader is ever stuck
        // on a page hunting for the way back.
        setPage((current) => (current === wanted ? "live" : wanted));
        setOverlay("none");
        return;
      }
      case "quote":
        void store.refresh(true);
        return;
      case "command":
        setTyping("");
        setAnswer(null);
        setRecalled(0);
        return;
      case "window":
        setWindowChoice((current) => (current === null ? 0 : current + 1 >= WINDOWS.length ? null : current + 1));
        return;
      case "step": {
        // The chart is the book's one market now, so the arrows choose the leg rather than turning a
        // carousel: which card is picked out, which leg `enter` opens, and which one the numbers land
        // on. A detail already open follows the choice, so stepping reads as moving along the book.
        const count = Math.max(1, snapshot?.legs.length ?? 1);
        setLegIndex((current) => (current + (key.leftArrow ? count - 1 : 1)) % count);
        setShown((current) => (current + (key.leftArrow ? count - 1 : 1)) % count);
        setStepped((n) => n + 1);
        return;
      }
      case "open": {
        setOverlay((current) => (current === "leg" ? "none" : "leg"));
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
  const marketWindowLabel = `${windowFor(LEG_ORDER[0] ?? 0).label} window${windowChoice === null ? " · auto" : ""} · t`;
  // The command row is a row of the screen, taken from the region below the charts rather than added
  // to the frame: a frame that grew by a row when the colon was pressed would reach `stdout.rows`
  // and make Ink clear the terminal on every repaint.
  const commandRows = typing === null ? 0 : 1;
  const feedRows = Math.max(0, regions.feedRows - commandRows);
  const pageRows = regions.graphRows + feedRows;

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
            // Picked out whether or not its detail is open: the arrows choose a leg, and a choice
            // with nothing on screen to show for it is not a choice a reader can make.
            selected={i === legIndex}
            windowSeconds={BigInt(windowFor(leg.config.chainId).seconds)}
          />
        ))}
      </Box>

      <Box flexDirection="column" width={regions.rightWidth} height={regions.draw} overflow="hidden">
        <Panel
          title={page === "live" ? "zentis" : `zentis · ${page}`}
          right={page === "live" ? undefined : "esc to the live view"}
          width={regions.rightWidth}
          height={regions.statusRows + 2}
        >
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
              height={pageRows}
            >
              <Help report={snapshot.sim} actions={actions} {...panelInner(regions.rightWidth, pageRows)} />
            </Panel>
          ) : page !== "live" ? (
            // A page takes the chart and the feed together: these are tables, and a table given half
            // the column and then clipped is a worse answer than the live view it replaced.
            <Panel
              title={page}
              right="esc to the live view"
              width={regions.rightWidth}
              height={pageRows}
            >
              {page === "positions" ? (
                <Positions snapshot={snapshot} {...panelInner(regions.rightWidth, pageRows)} />
              ) : page === "pnl" ? (
                <Pnl snapshot={snapshot} {...panelInner(regions.rightWidth, pageRows)} />
              ) : page === "wallet" ? (
                <WalletPage snapshot={snapshot} armed={armed} {...panelInner(regions.rightWidth, pageRows)} />
              ) : (
                <Simulation report={snapshot.sim} {...panelInner(regions.rightWidth, pageRows)} />
              )}
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
              // The source is worth naming — one series feeds the chart, the mid every leg quotes
              // from and the volatility half of the spread — but never at the cost of the window
              // label, which is the one thing on this border a key changes.
              title={(() => {
                const price = marketPrice(snapshot);
                const source = snapshot.market?.source ?? null;
                const lead = `market${price === null ? "" : ` · ${price}`}`;
                return chooseFit(
                  source === null
                    ? [lead, "market"]
                    : [`${lead} · ${source}`, `${lead} · ${source.split(",")[0]}`, lead, "market"],
                  Math.max(0, regions.rightWidth - marketWindowLabel.length - 8),
                );
              })()}
              right={marketWindowLabel}
              width={regions.rightWidth}
              height={regions.graphRows}
              colour={UI.reference}
            >
              <Graphs
                leg={rotating}
                snapshot={snapshot}
                {...graphInner}
                windowSeconds={BigInt(windowFor(rotating.config.chainId).seconds)}
              />
            </Panel>
          ))}

        {overlay !== "help" && page === "live" && (
          <Panel title="feed" width={regions.rightWidth} height={feedRows}>
            <Feed
              snapshot={snapshot}
              width={panelInner(regions.rightWidth, feedRows).width}
              rows={panelInner(regions.rightWidth, feedRows).height}
            />
          </Panel>
        )}

        {typing !== null && (
          <CommandLine text={typing} answer={answer} running={running !== null} width={regions.rightWidth} />
        )}
      </Box>
    </Box>
  );
}
