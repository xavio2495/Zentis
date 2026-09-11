import { expect, test } from "bun:test";
import { LEGS } from "./src/config.js";

import sepolia from "../../contracts/deployments/sepolia.json" with { type: "json" };

test("a leg counts its generations, the shipped one and every record it superseded", () => {
  // Read from the deployment record rather than written down: every re-ship adds one, and a number
  // typed here would turn the next re-ship into a failing test about nothing.
  const leg = LEGS.find((l) => l.name === "sepolia")!;
  const superseded = (sepolia as { supersededPositions?: unknown[] }).supersededPositions ?? [];
  expect(leg.generations).toBe(superseded.length + 1);
  expect(leg.generations).toBeGreaterThan(0);
});
