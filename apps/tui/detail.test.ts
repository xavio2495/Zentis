import { expect, test } from "bun:test";
import { referenceAgeSeconds } from "./src/components/LegDetail.js";
import type { LegSnapshot } from "@zentis/console-data";

const leg = (over: Partial<LegSnapshot>): LegSnapshot =>
  ({
    config: { chainId: 84532, label: "Base Sepolia" },
    position: null,
    ref: null,
    series: null,
    spread: null,
    shift: null,
    quoteAToB: null,
    quoteBToA: null,
    finality: null,
    caveats: [],
    sources: { fills: null, registry: null, pool: null },
    ...over,
  }) as unknown as LegSnapshot;

const now = 1_789_073_786;

test("an unread leg's reference age comes from the slot, not from a spread it does not have", () => {
  // The status bar said the reference was 21m old and Base's detail said the same seq was 0s old,
  // because the detail took its age from the spread stack, which an unread leg has none of, and
  // read the missing number as zero. The slot itself carries updatedAt, and it was read.
  const age = referenceAgeSeconds(leg({ ref: { seq: 1789072526, updatedAt: BigInt(now - 1260) } as never }), now);
  expect(age).toBe(1260);
});

test("a priced leg's reference age is the one the spread was computed from", () => {
  const age = referenceAgeSeconds(
    leg({ ref: { seq: 1, updatedAt: BigInt(now - 5000) } as never, spread: { referenceAgeSeconds: 1260 } as never }),
    now,
  );
  expect(age).toBe(1260);
});

test("no reference means no age, not an age of zero", () => {
  expect(referenceAgeSeconds(leg({}), now)).toBeNull();
});
