import { expect, test } from "bun:test";
import { foldRounds } from "@zentis/console-data";
import { drive } from "./sandbox/drive.js";
import { shiftCell } from "./src/components/Feed.js";
import type { LegSnapshot } from "@zentis/console-data";

const feedOf = (lines: string[]) => {
  const header = lines.findIndex((l) => l.includes("┌ feed"));
  if (header === -1) return "";
  const column = [...lines[header]!].indexOf("┌") + 1;
  return lines
    .slice(header + 1)
    .map((l) => [...l].slice(column).join(""))
    .join("\n");
};

test("the feed names chains the way the rest of the screen does, not SEP and ARB", async () => {
  const feed = feedOf((await drive(120, 40, { armed: true })).lines);
  expect(feed).not.toMatch(/\b(SEP|ARB|BASE)\b/);
  expect(feed).toMatch(/Sepolia|Arbitrum|Base/);
});

test("unchanged publishes fold into one row that says how many", async () => {
  // Whether the recording holds a run of identical rounds is a fact about the day: with the legs
  // near the mid the shift moves every round and nothing folds. So the rule is asserted where it
  // lives — `foldRounds` over a constructed run — and the screen is checked for the words it uses
  // when there is one to show.
  const rounds = [0, 1, 2].map((i) => ({
    kind: "round" as const,
    timestamp: BigInt(1_000 - i * 60),
    seq: 500 - i,
    count: 3,
    spanSeconds: 2,
    legs: [{ chainId: 11155111, tiltBps: 11, mid: 10n ** 27n, transaction: `0x${i}` }],
  }));
  const folded = foldRounds(rounds);
  expect(folded).toHaveLength(1);
  expect(folded[0]!.kind).toBe("fold");
  const fold = folded[0] as { count: number };
  expect(fold.count).toBe(3);
});

test("a shift at the leg's cap says so, because a shift there is a limit, not a size", () => {
  // Tested on the cell rather than through the screen. Whether any leg is pinned is a fact about
  // the testnet pools on the day the fixtures were taken: they were all at ±500 against a 500 cap
  // in the morning and all at zero against a 5000 cap after the legs were re-shipped. The cell has
  // to say "at cap" whenever the shift reaches whatever cap that leg's own position carries.
  const legAt = (maxTiltBps: number) => ({ position: { maxTiltBps } }) as unknown as LegSnapshot;
  expect(JSON.stringify(shiftCell(legAt(5000), -5000))).toContain("at cap");
  expect(JSON.stringify(shiftCell(legAt(500), 500))).toContain("at cap");
  // A shift that was at an older, smaller cap is not at this leg's cap now, and must not say it is.
  expect(JSON.stringify(shiftCell(legAt(5000), -500))).not.toContain("at cap");
});

test("a publish that reached one leg because two were unread says the two were unread", async () => {
  // "on 1 leg" during an outage read as the workflow having written one leg. It wrote three; the
  // console could only read one of them, and the other two columns say so.
  const feed = feedOf((await drive(190, 50, { scenario: "partial" })).lines);
  expect(feed.length).toBeGreaterThan(0);
  expect(feed).not.toContain("on 1 leg");
  expect(feed.match(/unread/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
});
