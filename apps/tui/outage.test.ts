import { expect, test } from "bun:test";
import { legState } from "./src/components/LegCard.js";
import { bookState } from "./src/components/StatusBar.js";
import type { LegSnapshot, Snapshot } from "@zentis/console-data";

const leg = (over: Partial<LegSnapshot>): LegSnapshot =>
  ({
    config: { chainId: 11155111, label: "Sepolia" },
    position: null,
    ref: null,
    series: null,
    spread: null,
    shift: null,
    quoteAToB: null,
    quoteBToA: null,
    finality: null,
    caveats: [],
    sources: { fills: null, registry: null, pool: null, quotes: null },
    ...over,
  }) as unknown as LegSnapshot;

test("a leg whose fills read failed is not reported as a leg with no position", () => {
  // The screenshot during the outage read "Base Sepolia no position" on all three cards, because a
  // 429 with a cold cache leaves `position` null — the same null that means "docked and gone". On a
  // console whose claim is one position on three chains, that says the position is absent.
  const unread = legState(leg({ sources: { fills: "subgraph HTTP 429", registry: null, pool: null, quotes: null } } as never));
  expect(unread.word).toContain("unavailable");
  expect(unread.word).not.toContain("no position");
});

test("a leg that really has no position still says so", () => {
  expect(legState(leg({})).word).toBe("no position");
});

test("the reset time travels with the refusal, because it is what says when to try again", () => {
  const state = legState(
    leg({ sources: { fills: "subgraph HTTP 429, resets 21:52Z", registry: null, pool: null, quotes: null } } as never),
  );
  expect(state.word).toContain("21:52Z");
});

test("the status bar leads with the outage when every fills read failed", () => {
  const snapshot = {
    legs: [
      leg({ sources: { fills: "subgraph HTTP 429, resets 21:52Z", registry: null, pool: null, quotes: null } } as never),
      leg({ sources: { fills: "subgraph HTTP 429, resets 21:52Z", registry: null, pool: null, quotes: null } } as never),
    ],
    seq: null,
    bookWeightA: 0n,
  } as unknown as Snapshot;

  const state = bookState(snapshot, false);
  // Not "legs are on different references": they are not on different references, they are unread,
  // and saying the book has come apart when it has not is the worse of the two errors. What the
  // endpoint actually replied is on its own status line now, so this row says the state and not the
  // reply.
  expect(state.variants[0]).toContain("unread");
  expect(state.variants[0]).not.toContain("different references");
});
