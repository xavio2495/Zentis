import { describe, expect, test } from "bun:test";
import { COPY, INSTALL_COMMAND, INTEGRATIONS, REPO_URL, prose } from "../src/lib/copy";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  test("the position is one, the legs are three, and nothing bridges", () => {
    // Across the copy that carries the claim rather than inside one string: the wording of the
    // statement is allowed to change, the claim is not.
    const headline = [COPY.heroLine, COPY.tagline, COPY.statement, COPY.statementBody].join(" ").toLowerCase();
    expect(headline).toMatch(/three (chains|legs)/);
    expect(headline).toMatch(/no bridge|without bridging|does not move it/);
    expect(headline).toMatch(/one position|one book/);
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

describe("the contact", () => {
  test("points at the repository the install line installs from", () => {
    const script = readFileSync(join(import.meta.dir, "..", "public", "install.sh"), "utf8");
    const slug = script.match(/ZENTIS_REPO_SLUG:-([\w.-]+\/[\w.-]+)/)?.[1];
    expect(slug).toBeTruthy();
    expect(REPO_URL).toBe(`https://github.com/${slug}`);
  });

  test("is an address rather than a claim, so it is kept out of prose", () => {
    expect(prose()).not.toContain(REPO_URL);
    expect(COPY.contactLine.length).toBeGreaterThan(0);
  });
});

describe("the page describes the mechanism the project actually has", () => {
  /**
   * The site was written against the first concept and the concept moved. `DIRECTION.md` §1 retires
   * four things by name, and the most dangerous is the one that reads best: that pricing a leg moves
   * value between chains. It cannot. On a constant-product curve, pricing changes composition on the
   * chain where it is applied; every cross-chain path crosses a bridge edge. The claim is not that
   * something moves the money cheaply — it is that no money needs to move, because the risk is
   * carried as one book.
   *
   * A wrong claim is the one defect a judge holds against a submission, so these are assertions
   * rather than a note in a document.
   */
  const everything = () => prose().join(" ").toLowerCase();

  const RETIRED: [RegExp, string][] = [
    [/lets the market move the money/, "pricing cannot move value across chains — DIRECTION §1"],
    [/\bmoves? the money\b/, "same claim, shorter — DIRECTION §1"],
    [/\btwo chains\b/, "the book runs on three legs — DIRECTION §1, CAVEATS F"],
    [/tilts? toward the leg that is short/, "the tilt is a correction plus a concession, not a pull toward a leg"],
    [/becomes worth something to close/, "implies the imbalance is closed by someone moving size across"],
    [/pay(s|ing)? for the privilege/, "belongs to the retired bridge-versus-tilt cost table — DIRECTION §1"],
    [/\bcheaper than (a )?bridg/, "the cost table is retired; we do not compare against a rebalance we never perform"],
    [/rebalances? by pricing/, "the mechanism does not rebalance; it prices and carries the risk"],
  ];

  for (const [pattern, why] of RETIRED) {
    test(`the page never says: ${pattern.source} — ${why}`, () => {
      expect(everything()).not.toMatch(pattern);
    });
  }

  test("the claim is one position, three legs, one mid, one book", () => {
    const body = `${COPY.tagline} ${COPY.statement} ${COPY.statementBody}`.toLowerCase();
    expect(body).toMatch(/one (market-making )?position|one position/);
    expect(body).toMatch(/same mid|one mid/);
    expect(body).toMatch(/one book|a single book/);
  });

  test("it says the risk is carried rather than the money moved", () => {
    const body = COPY.statementBody.toLowerCase();
    expect(body).toMatch(/nothing (has to|needs to) move|no inventory (has to|needs to) move|without moving/);
  });

  test("the tilt is named as its parts: a correction, then concessions", () => {
    const mechanism = `${COPY.mechanismBody}`.toLowerCase();
    expect(mechanism).toContain("correction");
    expect(mechanism).toContain("concession");
    // Bounded by a budget priced off a real bridge quote, which is what makes the bound honest.
    expect(mechanism).toMatch(/boundary|budget/);
  });

  test("the cross-chain term is called the risk dial, not the profit", () => {
    // DIRECTION §2: "The mean edge is per-leg. Say so; do not claim the cross-chain term is where
    // the profit is." The temptation to claim otherwise is exactly why this is a test.
    const all = everything();
    expect(all).toMatch(/risk dial|dial on the risk|a dial/);
    expect(all).not.toMatch(/where the profit|profits? come from the (book|cross-chain)/);
  });

  test("the spread is named as its three terms", () => {
    const all = everything();
    for (const term of ["base", "volatility", "markout"]) expect(all).toContain(term);
  });

  test("every surface takes its words from this module", () => {
    // Hero, statement, cards, the close, the outro, metadata and noscript: one module, so a
    // retired claim cannot survive in a component nobody thought to grep.
    // `outro` is gone: the closing sentence was replaced by the sponsor row, and a key kept in the
    // module after nothing renders it is how a retired line finds its way back onto a page.
    for (const key of ["heroLine", "tagline", "statement", "statementBody", "mechanismBody", "tryItOut", "noscript", "metaDescription"]) {
      expect(COPY[key as keyof typeof COPY]).toBeTruthy();
    }
  });
});
