import type { Key } from "ink";

/**
 * One table, two consumers: the input handler and the help page.
 *
 * The help page is generated from this table rather than written beside it, so the keys a reader is
 * told about cannot drift from the keys that work.
 *
 * **No modifier combos.** Every binding is a key that can be pressed alone. `?` is the one exception
 * a keyboard forces, and it is the only one.
 *
 * **Scopes resolve by precedence, not by mode.** While a confirmation is pending it takes every
 * key, so the key that broadcasts is never also a key that does something else; while an overlay is
 * open `esc` belongs to the overlay. There is no other precedence model.
 */
export type Scope = "confirm" | "overlay" | "main" | "global";

export interface Binding {
  readonly scope: Scope;
  readonly keys: string[];
  readonly label: string;
  readonly id: string;
}

export const BINDINGS: Binding[] = [
  { scope: "main", keys: ["left", "right"], label: "step the price chart to the previous or next leg", id: "step" },
  { scope: "main", keys: ["1", "2", "3"], label: "open a leg's detail; the same number closes it", id: "leg" },
  { scope: "main", keys: ["t"], label: "chart window: 1h, 24h, 7d, then back to automatic", id: "window" },
  { scope: "main", keys: ["p"], label: "positions: the legs as objects, and what they were shipped as", id: "positions" },
  { scope: "main", keys: ["n"], label: "profit and loss, per leg and for the book", id: "pnl" },
  { scope: "main", keys: ["w"], label: "the maker's wallet on each chain", id: "wallet" },
  { scope: "main", keys: ["m"], label: "the committed simulation run", id: "sim" },
  { scope: "overlay", keys: ["esc"], label: "back to the charts", id: "back" },
  // `esc` leaves a page for the live view, in `main` rather than `overlay`: a page is where the
  // reader is, not something drawn over where they were, and the keys stay live on it.
  { scope: "main", keys: ["esc"], label: "back to the live view", id: "live" },
  { scope: "global", keys: ["q"], label: "re-quote every leg now", id: "quote" },
  { scope: "main", keys: ["r"], label: "republish the fast workflow", id: "fast" },
  { scope: "main", keys: ["s"], label: "republish the slow workflow", id: "slow" },
  { scope: "main", keys: ["f"], label: "take the Sepolia leg's quote", id: "fill" },
  { scope: "confirm", keys: ["y"], label: "confirm, and broadcast", id: "confirm" },
  { scope: "global", keys: [":"], label: "type a command: fill, quote, republish, window, page", id: "command" },
  { scope: "global", keys: ["?"], label: "this page", id: "help" },
  { scope: "global", keys: ["x"], label: "quit", id: "quit" },
];

/** Ink's key object, in the vocabulary the table is written in. */
export function matches(spec: string, input: string, key: Key): boolean {
  switch (spec) {
    case "esc":
      return key.escape;
    case "enter":
      return key.return;
    case "left":
      return key.leftArrow;
    case "right":
      return key.rightArrow;
    case "up":
      return key.upArrow;
    case "down":
      return key.downArrow;
    default:
      return input === spec;
  }
}

export interface UiState {
  readonly confirming: boolean;
  readonly overlay: "none" | "leg" | "help";
}

/** Which scopes are live, most specific first. The order is the whole precedence model. */
export function scopesFor(state: UiState): Scope[] {
  if (state.confirming) return ["confirm"];
  // A leg's detail sits where the chart was and the rest of the screen stays live, so the main keys
  // stay live with it: the number that opened a detail closes it, another number jumps legs, and an
  // action can still be taken while reading. Help covers the whole right column and is a page to
  // read, so only its own keys and the global ones reach through it.
  if (state.overlay === "leg") return ["overlay", "main", "global"];
  if (state.overlay !== "none") return ["overlay", "global"];
  return ["main", "global"];
}

/** The binding a keystroke resolves to, or null. */
export function resolve(state: UiState, input: string, key: Key): Binding | null {
  const scopes = scopesFor(state);
  for (const scope of scopes) {
    const found = BINDINGS.find(
      (b) => b.scope === scope && b.keys.some((spec) => matches(spec, input, key)),
    );
    if (found !== undefined) return found;
  }
  return null;
}
