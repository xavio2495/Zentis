import "./stubs/browser-globals.js";
import { render } from "ink";
import { App } from "./App.js";
import { emitter } from "./stubs/node-stream.js";
import type { Action } from "./action-types.js";

/**
 * The console in a browser, writing into an xterm.js terminal.
 *
 * Ink is a React renderer that emits ANSI; only its *output* assumes Node. So the shim is small: an
 * object with `columns`, `rows`, a `write` that goes to the terminal, and enough of an event emitter
 * to satisfy the resize listener. Input goes the other way — xterm hands us keystrokes and we feed
 * them to a fake stdin that claims raw-mode support, because in a browser every key already arrives
 * raw.
 *
 * There are no actions here, and that is structural rather than promised: this bundle contains no
 * child-process machinery to run one with. The keys are still shown, disabled, with the reason —
 * a visitor should see what the operator's screen actually offers.
 */
export interface TerminalHandle {
  write(data: string): void;
  readonly cols: number;
  readonly rows: number;
  onData(handler: (data: string) => void): void;
  onResize(handler: (size: { cols: number; rows: number }) => void): void;
}

/** Ink brackets each frame in a synchronised-update pair; the opener marks the start of a frame. */
const SYNC_START = "\u001b[?2026h";
const HOME_AND_CLEAR = "\u001b[H\u001b[2J";

const WATCH_ONLY = "this is the public console, which watches and never signs";

const watchActions: Action[] = [
  { key: "r", label: "republish fast", disabledReason: WATCH_ONLY, command: null, describe: "" },
  { key: "s", label: "republish slow", disabledReason: WATCH_ONLY, command: null, describe: "" },
  { key: "f", label: "fill sepolia", disabledReason: WATCH_ONLY, command: null, describe: "" },
  {
    key: "q",
    label: "re-quote",
    disabledReason: null,
    command: null,
    describe: "re-reads every source and asks the router for a fresh quote",
  },
];

/** A minimal duplex pair over the terminal, carrying only what Ink actually touches. */
function streams(terminal: TerminalHandle) {
  const out = emitter();
  const stdout = Object.assign(out, {
    columns: terminal.cols,
    rows: terminal.rows,
    // Ink erases the previous frame with relative cursor moves, which assume it is the only thing
    // that has written to the terminal and that its idea of the cursor matches the terminal's. In
    // xterm that assumption breaks and successive frames tear into each other. Since Ink emits the
    // *whole* frame every time anyway, the fix is to stop trusting the relative erase: each frame
    // is preceded by a home-and-clear, so every render starts from a known position.
    write: (data: string) => {
      if (data.includes(SYNC_START)) terminal.write(HOME_AND_CLEAR);
      terminal.write(data);
      return true;
    },
    isTTY: true,
  });
  terminal.onResize(({ cols, rows }) => {
    stdout.columns = cols;
    stdout.rows = rows;
    out.fire("resize");
  });

  const inp = emitter();
  const stdin = Object.assign(inp, {
    // Every keystroke from xterm is already unbuffered and unechoed, so raw mode is not something
    // to switch on here — it is the only mode there is. Ink asks, and the honest answer is yes.
    isTTY: true,
    isRaw: true,
    setRawMode: () => stdin,
    setEncoding: () => stdin,
    resume: () => stdin,
    pause: () => stdin,
    read: () => null,
  });
  terminal.onData((data) => inp.fire("data", data));

  return { stdin, stdout };
}

export function mount(terminal: TerminalHandle) {
  const { stdin, stdout } = streams(terminal);
  return render(<App actions={watchActions} runAction={null} />, {
    stdout: stdout as never,
    stdin: stdin as never,
    // Ink's console patch reaches for Node's console internals, and there is no terminal here to
    // protect from stray logging anyway.
    patchConsole: false,
    exitOnCtrlC: false,
  });
}
