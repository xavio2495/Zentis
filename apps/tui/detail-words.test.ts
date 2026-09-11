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

// The generated "why" sentence moved to help, under the heading for this page: it read the numbers
// above it back in words, and it was taking the rows a refusal needs.

test("the detail carries the refusal's whole sentence, in the leg's own token names", async () => {
  const detail = detailOf((await drive(120, 40, { scenario: "refused", keys: ["1"] })).lines)
    .map((row) => row.replace(/│/g, "").trim())
    .join(" ");
  expect(detail).toContain("WETH → USDC");
  expect(detail.replace(/\s+/g, " ")).toContain("the maker would sell USDC for 322 bps less WETH than the floor allows");
  expect(detail).not.toContain("tokenA");
});
