import type { LegConfig, TokenConfig } from "@zentis/console-data";
import type { Page } from "./App.js";
import { WINDOWS } from "./window.js";

/**
 * What the operator typed, read into something the console can act on.
 *
 * The command line exists because the single keys cover one leg at one size: `f` fills Sepolia with
 * the demo's amount and nothing else. Typing is how an operator asks for the other leg, the other
 * side, or a different size — and every command here runs through exactly the same path its key
 * does, so nothing is reimplemented behind the colon.
 *
 * Parsing is pure and lives apart from the input row, because what a command *means* is the part
 * worth pinning: an amount misread by one decimal place is a fill ten times too large.
 */
export type Side = "AtoB" | "BtoA" | "both";

export type Command =
  | { kind: "page"; page: Page }
  | { kind: "window"; index: number | null }
  | { kind: "quote"; leg: LegConfig; amountRaw: bigint; side: Side }
  | { kind: "fill"; leg: LegConfig; amountRaw: bigint; isAToB: boolean }
  | { kind: "republish"; workflow: "fast" | "slow" }
  | { kind: "rebalance"; leg: LegConfig }
  | { kind: "push"; leg: LegConfig; token: TokenConfig; amountRaw: bigint }
  /** the approval a fill settles against; the amount is optional and defaults to the fill size */
  | { kind: "approve"; leg: LegConfig; amountRaw: bigint | null };

export type Parsed = { command: Command } | { error: string };

const KNOWN = ["fill", "quote", "approve", "republish", "window", "page", "rebalance", "push"] as const;

/**
 * A decimal amount in a token's raw units, scaled as text.
 *
 * Never through `Number`: an eighteen-decimal amount does not survive a float, and the one thing a
 * fill must not do is round the operator's number. More decimal places than the token has is a
 * refusal rather than a rounding, for the same reason.
 */
export function parseAmount(text: string, decimals: number): bigint | null {
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) return null;
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** The leg an operator means by a word, or why the word does not pick one. */
function findLeg(word: string, legs: readonly LegConfig[]): { leg: LegConfig } | { error: string } {
  const query = word.toLowerCase();
  const exact = legs.filter((l) => l.name === query || l.label.toLowerCase() === query);
  // Every leg's name ends in "sepolia", so an exact match is taken before any prefix: on these
  // chains "sepolia" names one leg, and a prefix rule alone would let it mean whichever came first.
  const matches =
    exact.length > 0
      ? exact
      : legs.filter((l) => l.name.startsWith(query) || l.label.toLowerCase().startsWith(query));
  if (matches.length === 1) return { leg: matches[0]! };
  if (matches.length === 0) {
    return { error: `no leg called "${word}" — the legs are ${legs.map((l) => l.name).join(", ")}` };
  }
  return { error: `"${word}" could be ${matches.map((l) => l.name).join(" or ")}` };
}

const PAGES: Record<string, Page> = {
  live: "live",
  positions: "positions",
  pnl: "pnl",
  wallet: "wallet",
  sim: "simulation",
  simulation: "simulation",
};

const sideOf = (word: string | undefined): Side | null => {
  if (word === undefined) return "both";
  if (word.toLowerCase() === "a") return "AtoB";
  if (word.toLowerCase() === "b") return "BtoA";
  return null;
};

export function parseCommand(line: string, legs: readonly LegConfig[]): Parsed {
  const [verb, ...rest] = line.trim().split(/\s+/).filter((word) => word !== "");
  if (verb === undefined) return { error: `type one of: ${KNOWN.join(", ")}` };

  const legAnd = (word: string | undefined, what: string) => {
    if (word === undefined) return { error: `${verb} needs ${what}` } as const;
    return findLeg(word, legs);
  };

  switch (verb.toLowerCase()) {
    case "page": {
      const page = rest[0] === undefined ? undefined : PAGES[rest[0].toLowerCase()];
      return page === undefined
        ? { error: `page takes one of: ${[...new Set(Object.values(PAGES))].join(", ")}` }
        : { command: { kind: "page", page } };
    }
    case "window": {
      const word = rest[0]?.toLowerCase();
      if (word === "auto") return { command: { kind: "window", index: null } };
      const index = WINDOWS.findIndex((w) => w.label.toLowerCase() === word);
      return index === -1
        ? { error: `window takes ${WINDOWS.map((w) => w.label).join(", ")} or auto` }
        : { command: { kind: "window", index } };
    }
    case "republish": {
      const workflow = rest[0]?.toLowerCase();
      return workflow === "fast" || workflow === "slow"
        ? { command: { kind: "republish", workflow } }
        : { error: "republish takes fast or slow" };
    }
    case "approve": {
      const found = legAnd(rest[0], "a leg");
      if ("error" in found) return found;
      const amountRaw = rest[1] === undefined ? null : parseAmount(rest[1], found.leg.tokenA.decimals);
      if (rest[1] !== undefined && amountRaw === null) {
        return { error: `approve takes an amount in ${found.leg.tokenA.symbol}, or none for the usual size` };
      }
      return { command: { kind: "approve", leg: found.leg, amountRaw } };
    }
    case "rebalance": {
      const found = legAnd(rest[0], "a leg");
      return "error" in found ? found : { command: { kind: "rebalance", leg: found.leg } };
    }
    case "quote":
    case "fill": {
      const found = legAnd(rest[0], "a leg and an amount");
      if ("error" in found) return found;
      const side = sideOf(rest[2]);
      if (side === null) return { error: `${verb}'s side is a (${found.leg.tokenA.symbol} in) or b (${found.leg.tokenB.symbol} in)` };
      // The side decides which token the amount is in: it is what the taker hands over.
      const isAToB = side !== "BtoA";
      const token = isAToB ? found.leg.tokenA : found.leg.tokenB;
      const amountRaw = rest[1] === undefined ? null : parseAmount(rest[1], token.decimals);
      if (amountRaw === null || amountRaw === 0n) {
        return { error: `${verb} needs an amount in ${token.symbol}, with at most ${token.decimals} decimals` };
      }
      return verb.toLowerCase() === "quote"
        ? { command: { kind: "quote", leg: found.leg, amountRaw, side } }
        : { command: { kind: "fill", leg: found.leg, amountRaw, isAToB } };
    }
    case "push": {
      const found = legAnd(rest[0], "a leg, a token and an amount");
      if ("error" in found) return found;
      const symbol = rest[1]?.toUpperCase();
      const token = [found.leg.tokenA, found.leg.tokenB].find((t) => t.symbol.toUpperCase() === symbol);
      if (token === undefined) {
        return { error: `push takes ${found.leg.tokenA.symbol} or ${found.leg.tokenB.symbol} on ${found.leg.name}` };
      }
      const amountRaw = rest[2] === undefined ? null : parseAmount(rest[2], token.decimals);
      return amountRaw === null || amountRaw === 0n
        ? { error: `push needs an amount in ${token.symbol}, with at most ${token.decimals} decimals` }
        : { command: { kind: "push", leg: found.leg, token, amountRaw } };
    }
    default:
      return { error: `no command called "${verb}" — try ${KNOWN.join(", ")}` };
  }
}
