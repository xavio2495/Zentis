import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SPONSORS } from "@/lib/sponsors";

/**
 * The row of who this was built on and built for.
 *
 * Each entry names a file it would like to draw, and falls back to its own name set in the label
 * token when that file is not there. The fallback is the user's own instruction — "if you cannot
 * find one, tell them which rather than substituting" — so a missing mark is visible as a missing
 * mark rather than quietly becoming someone else's logo or a redrawn approximation.
 *
 * Every entry that does have a file must also have a sidecar recording where it came from and what
 * its guidelines permit. A brand asset in a repository without its licence note is a liability
 * rather than an asset.
 */
const brand = (...p: string[]) => join(import.meta.dir, "..", "public", "brand", "sponsors", ...p);

describe("the row", () => {
  test("names the five, in the order the page shows them", () => {
    expect(SPONSORS.map((s) => s.name)).toEqual(["ETHGlobal", "ETHOnline 2026", "1inch", "The Graph", "Chainlink"]);
  });

  test("every one links to its own site, over https", () => {
    for (const sponsor of SPONSORS) {
      expect(sponsor.href).toMatch(/^https:\/\//);
      expect(sponsor.name.length).toBeGreaterThan(0);
    }
  });

  test("every one says whether its mark may be set in one colour", () => {
    // Not a detail: several brand guidelines forbid recolouring, and the row honours --text-soft
    // only where that is allowed.
    for (const sponsor of SPONSORS) {
      expect(typeof sponsor.monochrome).toBe("boolean");
    }
  });
});

describe("a mark is only drawn when it is really there", () => {
  for (const sponsor of SPONSORS) {
    test(`${sponsor.name}: either a file that exists, or no file at all`, () => {
      if (sponsor.file === null) return;
      expect(existsSync(brand(sponsor.file))).toBe(true);
    });

    test(`${sponsor.name}: a file on disk carries its source and its licence beside it`, () => {
      if (sponsor.file === null) return;
      const sidecar = brand(`${sponsor.file.replace(/\.[^.]+$/, "")}.json`);
      expect(existsSync(sidecar)).toBe(true);
      const note = JSON.parse(readFileSync(sidecar, "utf8"));
      expect(note.source).toMatch(/^https:\/\//);
      expect(typeof note.licence).toBe("string");
      expect(note.licence.length).toBeGreaterThan(0);
      expect(typeof note.monochromePermitted).toBe("boolean");
    });
  }
});

describe("the closing line", () => {
  test("the row stands where the outro sentence used to", () => {
    const page = readFileSync(join(import.meta.dir, "..", "src", "app", "page.tsx"), "utf8");
    expect(page).toContain("SponsorRow");
    expect(page).not.toContain("COPY.outro");
  });
});
