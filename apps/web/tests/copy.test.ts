import { describe, expect, test } from "bun:test";
import { COPY, INSTALL_COMMAND, INTEGRATIONS, prose } from "../src/lib/copy";

describe("the page makes no claim it cannot source", () => {
  test("no figure appears anywhere in the prose", () => {
    // Every number on this site has to trace to a committed simulation run or a
    // real fill. Until those exist, the page carries none.
    const offenders = prose().filter((line) => /\d/.test(line));
    expect(offenders).toEqual([]);
  });

  test("the three integrations are described only as the project defines them", () => {
    expect(INTEGRATIONS.map((i) => i.name)).toEqual(["1inch", "The Graph", "Chainlink"]);
    expect(INTEGRATIONS[0].claim).toContain("unmodified");
    expect(INTEGRATIONS[1].claim).toContain("subgraph");
    expect(INTEGRATIONS[1].claim.toLowerCase()).toContain("three");
    expect(INTEGRATIONS[2].claim).toContain("registry");
    for (const integration of INTEGRATIONS) {
      expect(integration.claim.length).toBeLessThan(140);
    }
  });

  test("the position is one, and the chains are three", () => {
    expect(COPY.statement.toLowerCase()).toContain("three chains");
    expect(COPY.statement.toLowerCase()).toContain("no bridge");
  });
});

describe("the install line", () => {
  test("is the one the site actually serves", () => {
    expect(INSTALL_COMMAND).toBe("curl -fsSL https://zentis-eth.vercel.app/install.sh | bash");
  });

  test("is exempt from the no-figure rule and so is kept out of prose", () => {
    expect(prose()).not.toContain(INSTALL_COMMAND);
  });
});

describe("the first screen", () => {
  test("carries a wordmark, a tracked line and one serif tagline", () => {
    expect(COPY.wordmark).toBe("ZENTIS");
    expect(COPY.heroLine.split("·").length).toBe(3);
    expect(COPY.tagline.length).toBeGreaterThan(0);
  });

  test("has copy for readers without javascript", () => {
    expect(COPY.noscript.length).toBeGreaterThan(80);
  });
});
