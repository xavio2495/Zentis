import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

const detailOf = (lines: string[]) => {
  const top = lines.findIndex((l) => l.includes("esc to close"));
  const column = [...lines[top]!].indexOf("┌");
  const out: string[] = [];
  for (const line of lines.slice(top + 1)) {
    const cell = [...line].slice(column).join("");
    if (cell.startsWith("╰")) break;
    out.push(cell);
  }
  return out;
};

test("no raw integer of the policy's units reaches the detail", async () => {
  // The mid is raw tokenB per 1e18 raw tokenA — a 27-to-29-digit integer nobody reads — and a
  // Uniswap v3 liquidity value is not an amount of any token.
  const detail = detailOf((await drive(120, 40, { keys: ["1"] })).lines).join("\n");
  expect(detail).not.toMatch(/\d{13,}/);
  expect(detail).not.toContain("liquidity");
  expect(detail).toMatch(/1 WETH = [\d,]+ USDC/);
});

test("the why line is labelled in the same column as pool and reference", async () => {
  const rows = detailOf((await drive(120, 40, { keys: ["1"] })).lines);
  const col = (label: string) => {
    const row = rows.find((r) => r.includes(`│${label} `) || r.startsWith(`│${label}`));
    return row === undefined ? -1 : [...row].indexOf(label[0]!) ;
  };
  const whyRow = rows.find((r) => /^│why\s{2,}\S/.test(r));
  expect(whyRow).toBeDefined();
  // "why" is followed by padding to the value column, like "pool" and "reference" are.
  const valueColumn = (row: string) => [...row].findIndex((c, i) => i > 1 && c !== " " && [...row][i - 1] === " ");
  const poolRow = rows.find((r) => r.startsWith("│pool"))!;
  expect(valueColumn(whyRow!)).toBe(valueColumn(poolRow));
  expect(col("why")).toBeGreaterThan(-1);
});
