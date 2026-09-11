import { expect, test } from "bun:test";
import { fillsSubgraphUrl, rpcOverride } from "./src/config.js";

/**
 * Every endpoint the console reads can be pointed elsewhere by the environment.
 *
 * This is what lets a test start the real binary without it reaching the indexers. A compiled
 * console left running polls the fills subgraphs once a minute, and seventeen of them drained two
 * legs' daily allowance to zero — the endpoints must be overridable, not just the RPCs.
 */
test("a leg's fills subgraph can be pointed somewhere else, per leg", () => {
  expect(fillsSubgraphUrl("sepolia", "https://api.studio.thegraph.com/real", {})).toBe(
    "https://api.studio.thegraph.com/real",
  );
  expect(
    fillsSubgraphUrl("sepolia", "https://api.studio.thegraph.com/real", {
      ZENTIS_FILLS_SEPOLIA: "http://127.0.0.1:1",
    }),
  ).toBe("http://127.0.0.1:1");
  // An empty override is not an override: a variable set to nothing means "unset" in a shell.
  expect(fillsSubgraphUrl("base-sepolia", "https://real", { ZENTIS_FILLS_BASE_SEPOLIA: "" })).toBe("https://real");
});

test("the same rule already governs the RPCs, and is spelled the same way", () => {
  expect(rpcOverride("sepolia", { ZENTIS_RPC_SEPOLIA: "http://127.0.0.1:1" })).toBe("http://127.0.0.1:1");
  expect(rpcOverride("sepolia", {})).toContain("://");
});
