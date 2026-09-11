import { expect, test } from "bun:test";
import { LEGS } from "@zentis/console-data";
import { parseAmount, parseCommand } from "./src/command.js";

const parse = (line: string) => parseCommand(line, LEGS);
const ok = (line: string) => {
  const result = parse(line);
  if ("error" in result) throw new Error(`${line}: ${result.error}`);
  return result.command;
};
const err = (line: string) => {
  const result = parse(line);
  if (!("error" in result)) throw new Error(`${line} parsed, and should not have`);
  return result.error;
};

test("an amount is read as digits, never through a float that would round the last of them", () => {
  // 0.1 + 0.2 is the reason: raw units are integers and the text is scaled as text.
  expect(parseAmount("0.15", 6)).toBe(150_000n);
  expect(parseAmount("1", 18)).toBe(10n ** 18n);
  expect(parseAmount("0.000000000000000001", 18)).toBe(1n);
  expect(parseAmount("12.3456789", 6)).toBeNull(); // more places than the token has
  expect(parseAmount("", 6)).toBeNull();
  expect(parseAmount("-1", 6)).toBeNull();
  expect(parseAmount("1e3", 6)).toBeNull();
});

test("a leg is named the way a reader would name it, and an ambiguous name is refused", () => {
  const quote = ok("quote sepolia 0.15");
  expect(quote.kind).toBe("quote");
  if (quote.kind !== "quote") throw new Error("not a quote");
  expect(quote.leg.name).toBe("sepolia");
  expect(ok("quote BASE 1").kind).toBe("quote");
  expect(err("quote nowhere 1")).toContain("nowhere");
  // Every leg's name ends in "sepolia", so the bare word has to mean the leg called sepolia and
  // nothing else, rather than silently picking the first of three.
  expect(ok("quote arbitrum 1")).toBeDefined();
});

test("a quote asks both directions unless a side is given", () => {
  const both = ok("quote sepolia 0.15");
  if (both.kind !== "quote") throw new Error("not a quote");
  expect(both.side).toBe("both");
  const one = ok("quote sepolia 0.15 b");
  if (one.kind !== "quote") throw new Error("not a quote");
  expect(one.side).toBe("BtoA");
});

test("a fill defaults to the token A side, which is the direction the demo's beat runs", () => {
  const fill = ok("fill sepolia 0.15");
  if (fill.kind !== "fill") throw new Error("not a fill");
  expect(fill.isAToB).toBe(true);
  expect(fill.amountRaw).toBe(150_000n);
  const other = ok("fill sepolia 0.0001 b");
  if (other.kind !== "fill") throw new Error("not a fill");
  expect(other.isAToB).toBe(false);
});

test("navigation and the chart window are commands as well as keys", () => {
  expect(ok("page wallet")).toEqual({ kind: "page", page: "wallet" });
  expect(ok("page sim")).toEqual({ kind: "page", page: "simulation" });
  expect(ok("window 24h")).toEqual({ kind: "window", index: 1 });
  expect(ok("window auto")).toEqual({ kind: "window", index: null });
  expect(err("window 3h")).toContain("1h");
});

test("republish names its workflow, and push names its token", () => {
  expect(ok("republish fast")).toEqual({ kind: "republish", workflow: "fast" });
  expect(err("republish")).toContain("fast");
  const push = ok("push base weth 0.001");
  if (push.kind !== "push") throw new Error("not a push");
  expect(push.token.symbol).toBe("WETH");
  expect(push.amountRaw).toBe(10n ** 15n);
});

test("an unknown command answers with the ones that exist rather than a shrug", () => {
  const message = err("frobnicate");
  expect(message).toContain("frobnicate");
  for (const known of ["fill", "quote", "republish", "window", "page", "rebalance", "push"]) {
    expect(message).toContain(known);
  }
  expect(err("")).toBeDefined();
});
