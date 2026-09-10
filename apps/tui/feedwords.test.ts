import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

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
  const feed = feedOf((await drive(120, 40, { armed: true })).lines);
  expect(feed).toMatch(/\d+ publishes/);
});

test("a shift at the leg's cap says so, because -500 there is a limit, not a size", async () => {
  const feed = feedOf((await drive(190, 50, { armed: true })).lines);
  expect(feed).toContain("at cap");
});

test("a publish that reached one leg because two were unread says the two were unread", async () => {
  // "on 1 leg" during an outage read as the workflow having written one leg. It wrote three; the
  // console could only read one of them.
  const feed = feedOf((await drive(190, 50, { scenario: "partial" })).lines);
  expect(feed.length).toBeGreaterThan(0);
  expect(feed).not.toContain("on 1 leg");
  expect(feed).toContain("2 legs unread");
});
