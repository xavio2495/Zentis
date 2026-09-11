import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  BOOK,
  LEGS,
  type LegConfig,
  type PushPlan,
  type Store,
  createStore,
  fetchQuotes,
  offMidBps,
  pushPlan,
} from "@zentis/console-data";
import type { Action } from "./action-types.js";
import { type PublisherMode, quoteAvailability } from "./actions.js";
import { readQuote } from "./quote.js";
import { roleOf } from "./role.js";
import { Feed } from "./components/Feed.js";
import { Graphs, marketPrice } from "./components/Graphs.js";
import { Help } from "./components/Help.js";
import { LegCard } from "./components/LegCard.js";
import { LegDetail } from "./components/LegDetail.js";
import { CommandLine } from "./components/CommandLine.js";
import { Panel, panelInner } from "./components/Panel.js";
import { Pnl } from "./pages/Pnl.js";
import { Onboarding } from "./pages/Onboarding.js";
import { Positions } from "./pages/Positions.js";
import { Status } from "./pages/Status.js";
import { Simulation } from "./pages/Simulation.js";
import { WalletPage } from "./pages/WalletPage.js";
import { StatusBar, hints } from "./components/StatusBar.js";
import { Segments } from "./components/Segments.js";
import { type Pending, landed } from "./landed.js";
import { chooseFit, pairPrice, tokenAmount } from "./format.js";
import { MIN_COLS, MIN_ROWS, fit, useSize } from "./layout.js";
import { type Command, parseCommand } from "./command.js";
import { resolve } from "./keymap.js";
import { spinnerAt } from "./spinner.js";
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


/** The pages, and the word the status bar names each one by. */
export type Page = "live" | "positions" | "pnl" | "wallet" | "simulation" | "status";
const PAGE_OF: Record<string, Page> = {
  positions: "positions",
  pnl: "pnl",
  wallet: "wallet",
  sim: "simulation",
  status: "status",
};

export function App({
  actions,
  runAction,
  makeStore = createStore,
  commands = null,
  publisher = "none",
  address = null,
  onboarding = false,
  onChoose,
}: {
  actions: Action[];
  /**
   * How a typed command becomes an action, so `:fill base 0.3` and the `f` key produce the same
   * `Action`, ask the same confirmation and are refused in the same words. Null means the console
   * was given no way to sign, which the row says when a signing command is typed.
   */
  commands?: {
    fill: (fill: { leg: LegConfig; amountRaw: bigint; isAToB: boolean }) => Action;
    republish: (workflow: "fast" | "slow") => Action | null;
    push: (push: { leg: LegConfig; plan: PushPlan }) => Action;
  } | null;
  /**
   * Which publisher this console can reach. It decides whether `r` and `s` exist at all — with none
   * they are not offered, not disabled — and the status page says which one is in use.
   */
  publisher?: PublisherMode;
  /** the address this console holds a key for, or null when it holds none */
  address?: string | null;
  /**
   * True when this console has no key and has not been told to watch: a stranger's first run. The
   * live view is not drawn until they have chosen, because two of the three choices change what it
   * would show.
   */
  onboarding?: boolean;
  /** what to do with a choice: make a wallet, take a path, or watch. Null in the sandbox. */
  onChoose?: ((choice: "generate" | "existing" | "watch") => Promise<string | null>) | null;
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
  // How far the help page has been scrolled. Reset whenever it is opened, so `?` always starts at
  // the top rather than wherever it was left.
  const [helpAt, setHelpAt] = useState(0);
  // First run: which choice is being acted on, and what the signing child said about it.
  const [choosing, setChoosing] = useState(false);
  const [chose, setChose] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState(false);
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
  const [transient, setTransient] = useState<{ text: string; quiet: boolean; at: number } | null>(null);
  const say = (text: string, quiet = false) => setTransient({ text, quiet, at: Date.now() });
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
  // The window the chart draws is the window asked of the service, so a short one comes back per
  // swap instead of as two hourly closes joined by a straight line.
  const marketHours = Math.max(
    1,
    Math.round((WINDOWS[windowChoice ?? WINDOWS.length - 1] ?? WINDOWS[WINDOWS.length - 1]!).seconds / 3600),
  );
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

  // A note takes the book's row for five seconds and then gives it back. It is news, not state: the
  // thing it is about — watch-only, a running command — is on the screen in its own right, and a
  // sentence that stays forever stops being read while still holding the row it sits in.
  const NOTE_MS = 5_000;
  useEffect(() => {
    if (transient === null) return undefined;
    const timer = setTimeout(() => setTransient((current) => (current?.at === transient.at ? null : current)), NOTE_MS);
    return () => clearTimeout(timer);
  }, [transient]);

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
        // Read here, in this process, through the same static call the contracts require. No key, so
        // it answers watch-only; no child process, so it answers on a device that has only this
        // binary; and no quote service, so it answers when that service is the thing that is down.
        const unavailable = quoteAvailability(command.leg);
        if (unavailable !== null) {
          setAnswer({ text: unavailable, bad: true });
          return;
        }
        const sides = command.side === "both" ? [true, false] : [command.side === "AtoB"];
        setAnswer({ text: "asking the router…", bad: false });
        void Promise.all(
          sides.map(async (isAToB) => {
            const { amountIn, amountOut } = await readQuote(command.leg, { amountRaw: command.amountRaw, isAToB });
            const [from, to] = isAToB
              ? [command.leg.tokenA, command.leg.tokenB]
              : [command.leg.tokenB, command.leg.tokenA];
            return (
              `${tokenAmount(amountIn, from.decimals)} ${from.symbol} → ` +
              `${tokenAmount(amountOut, to.decimals)} ${to.symbol}`
            );
          }),
        )
          .then((lines) => setAnswer({ text: lines.join("   ·   "), bad: false }))
          .catch((cause: unknown) => setAnswer({ text: `the router did not answer: ${String(cause)}`, bad: true }));
        return;
      }
      case "rebalance":
        // The panel is the answer to this question: it sizes the top-up from the leg's own reserves
        // against the mid, and says so for every leg at once.
        setPage("positions");
        setAnswer({ text: `${command.leg.name}'s rebalance is on the positions page`, bad: false });
        return;
      case "push": {
        // The console's own three calls, sized from what it has already read: the committed balances
        // over RPC, the published mid, and the wallet's own tokenB holding and allowance. It still
        // asks before it broadcasts, and the operator is the one who answers.
        if (commands === null) {
          setAnswer({ text: "this console was given no way to sign, so it cannot run that", bad: true });
          return;
        }
        const leg = snapshot?.legs.find((l) => l.config.chainId === command.leg.chainId) ?? null;
        const chain = snapshot?.wallet?.chains.find((c) => c.chainId === command.leg.chainId) ?? null;
        if (leg === null || leg.ref === null || chain === null) {
          setAnswer({ text: `${command.leg.name} has not been read yet, so a push cannot be sized`, bad: true });
          return;
        }
        // The amount typed is what the operator wants moved; the plan says what that costs in
        // approval and wrapping, and refuses a leg a push cannot help.
        const planned = pushPlan({
          balanceA: chain.tokenA.committed,
          balanceB: chain.tokenB.committed,
          mid: leg.ref.mid,
          held: chain.tokenB.held,
          allowance: chain.tokenB.allowance,
        });
        if (planned === null) {
          setAnswer({ text: `${command.leg.name} holds more than the mid says it should; a push cannot fix that`, bad: true });
          return;
        }
        const action = commands.push({ leg: command.leg, plan: { ...planned, topUpB: command.amountRaw } });
        if (action.disabledReason !== null) {
          setAnswer({ text: action.disabledReason, bad: true });
          return;
        }
        setTyping(null);
        setAnswer(null);
        setConfirming(action);
        say(`press y to broadcast — ${action.label}: ${action.describe}`);
        return;
      }
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
        if (action === null) {
          // Not "you are missing a variable": this console simply is not the one that republishes,
          // and the workflows run on their own regardless.
          setAnswer({
            text: "republishing is an operator action; the publisher runs on its own every five minutes",
            bad: false,
          });
          return;
        }
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
    // First run takes the keyboard until it is answered: two of the three choices change what the
    // live view would even show, so there is nothing useful to press behind this.
    if (onboarding && !onboarded) {
      if (input === "3") {
        setOnboarded(true);
        return;
      }
      if (input === "1" && !choosing && onChoose != null) {
        setChoosing(true);
        void onChoose("generate")
          .then((said) => setChose(said))
          .catch((cause: unknown) => setChose(String(cause)))
          .finally(() => setChoosing(false));
      }
      if (input === "2" && onChoose != null) {
        // A path is typed, so this hands over to the command row rather than inventing a second one.
        setTyping("");
        setAnswer({ text: "type the path to an env file with TAKER_PRIVATE_KEY in it", bad: false });
        setOnboarded(true);
      }
      if (key.escape || input === "x") exit();
      return;
    }

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
        setHelpAt(0);
        setOverlay((current) => (current === "help" ? "none" : "help"));
        return;
      case "scroll": {
        // Half a page a press, the convention every pager uses: enough to move, little enough to
        // keep a line of context from what was just read.
        const step = Math.max(3, Math.floor(fit(size.cols, size.rows).graphRows / 2));
        setHelpAt((current) => Math.max(0, current + (key.upArrow ? -step : step)));
        return;
      }
      case "back":
        setOverlay("none");
        return;
      case "live":
        setPage("live");
        return;
      case "positions":
      case "pnl":
      case "wallet":
      case "status":
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

  if (onboarding && !onboarded) {
    return (
      <Box width={regions.legsWidth + regions.rightWidth} height={regions.draw} overflow="hidden">
        <Panel title="zentis" width={regions.legsWidth + regions.rightWidth} height={regions.draw}>
          <Onboarding
            running={choosing}
            said={chose}
            {...panelInner(regions.legsWidth + regions.rightWidth, regions.draw)}
          />
        </Panel>
      </Box>
    );
  }

  if (snapshot === null) {
    // A spinner and what it is waiting on. The sentence that used to be here listed every source the
    // console reads, which is the status panel's job the moment there is one.
    return (
      <Box width={regions.legsWidth + regions.rightWidth} height={regions.draw} overflow="hidden">
        <Text color={state.error === null ? UI.muted : UI.caveat}>
          {state.error === null ? `${spinnerAt(Date.now())} reading the chains and the services` : state.error}
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
  // One window for one chart. The automatic rule was written for per-leg pools, where a testnet
  // venue might have three swaps in a week and the window had to reach back to the last fill; the
  // book's market has a point every hour, so automatic is simply the whole week, and `t` cycles the
  // shorter ones. Taking the label from a leg's automatic window put "1h window" over six days.
  const marketWindow = WINDOWS[windowChoice ?? WINDOWS.length - 1] ?? WINDOWS[WINDOWS.length - 1]!;
  const marketWindowLabel = `${marketWindow.label} window${windowChoice === null ? " · auto" : ""} · t`;
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
              <Help actions={actions} offset={helpAt} {...panelInner(regions.rightWidth, pageRows)} />
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
              ) : page === "status" ? (
                <Status
                  snapshot={snapshot}
                  publisher={publisher}
                  role={roleOf(address)}
                  address={address}
                  {...panelInner(regions.rightWidth, pageRows)}
                />
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
                windowSeconds={BigInt(marketWindow.seconds)}
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

        {regions.keyRows > 0 && (
          <Panel title="keys" width={regions.rightWidth} height={regions.keyRows + 2}>
            <Box width={panelInner(regions.rightWidth, regions.keyRows + 2).width} height={regions.keyRows} overflow="hidden">
              <Segments segs={hints(actions, panelInner(regions.rightWidth, regions.keyRows + 2).width)} />
            </Box>
          </Panel>
        )}

        {typing !== null && (
          <CommandLine text={typing} answer={answer} running={running !== null} width={regions.rightWidth} />
        )}
      </Box>
    </Box>
  );
}
