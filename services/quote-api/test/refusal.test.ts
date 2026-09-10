import { describe, expect, test } from "bun:test";
import { encodeErrorResult } from "viem";
import { ZENTIS_ERRORS, decodeRefusal } from "../src/refusal.js";

const encode = (errorName: string, args: unknown[]) =>
  encodeErrorResult({ abi: ZENTIS_ERRORS, errorName, args } as never);

describe("decoding a router refusal", () => {
  test("the band's floor refusal says which way the maker would lose and by how much", () => {
    // The values the Sepolia leg reverted with on 2026-09-10 for WETH → USDC: the position's own
    // curve sits far above the reference, so in this direction the maker would sell tokenA under
    // the floor. "execution reverted" told the operator none of that.
    const refusal = decodeRefusal(
      encode("ZentisOutsideBand", [29724673774574501050118783n, 30729434174266290381818987n, false]),
    );
    expect(refusal?.error).toBe("ZentisOutsideBand");
    expect(refusal?.sentence).toContain("outside the band");
    expect(refusal?.sentence).toContain("floor");
    expect(refusal?.sentence).toContain("327 bps");
    expect(refusal?.sentence).toContain("tokenA");
  });

  test("the band's ceiling refusal is the other direction", () => {
    const refusal = decodeRefusal(encode("ZentisOutsideBand", [1_100n, 1_000n, true]));
    expect(refusal?.sentence).toContain("ceiling");
    expect(refusal?.sentence).toContain("1000 bps");
  });

  test("a stale reference names the age and the limit", () => {
    const refusal = decodeRefusal(encode("ZentisReferenceStale", [6700n, 3600]));
    expect(refusal?.sentence).toContain("6700s");
    expect(refusal?.sentence).toContain("3600s");
  });

  test("a seq pin that missed names both numbers", () => {
    const refusal = decodeRefusal(encode("ZentisSeqMismatch", [10, 11]));
    expect(refusal?.sentence).toContain("10");
    expect(refusal?.sentence).toContain("11");
  });

  test("an error with no sentence of its own still gets its name and arguments", () => {
    const refusal = decodeRefusal(encode("ZentisSpreadTooWide", [7000n]));
    expect(refusal?.error).toBe("ZentisSpreadTooWide");
    expect(refusal?.args).toEqual(["7000"]);
    expect(refusal?.sentence).toContain("ZentisSpreadTooWide");
  });

  test("data that is not a Zentis error decodes to nothing rather than to a wrong sentence", () => {
    expect(decodeRefusal("0x")).toBeNull();
    expect(decodeRefusal("")).toBeNull();
    expect(decodeRefusal("0xdeadbeef0000000000000000000000000000000000000000000000000000000000000001")).toBeNull();
  });
});
