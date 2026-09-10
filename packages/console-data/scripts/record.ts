import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOOK, LEGS } from "../src/config.js";
import { historyQuery } from "../src/fills.js";
import { swapsQuery } from "../src/pool.js";
import { fetchRef } from "../src/registry.js";

/**
 * Records the five sources as they answered, so the tests run on shapes the endpoints really
 * produce rather than on shapes we imagined. Re-run it when a subgraph version changes; the
 * recorded state is a moment, and the tests assert on the invariants of that moment, not on
 * whatever the chain says today.
 */
const dir = join(import.meta.dir, "..", "fixtures");
mkdirSync(dir, { recursive: true });

const write = (name: string, value: unknown) => {
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`recorded ${name}`);
};

const post = async (url: string, body: string) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: `{ _meta { hasIndexingErrors } ${body} }` }),
  });
  const payload = (await response.json()) as { data?: unknown; errors?: unknown };
  if (payload.data === undefined) throw new Error(`${url}: ${JSON.stringify(payload.errors)}`);
  return payload.data;
};

const stringifyBigints = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

for (const leg of LEGS) {
  write(`history-${leg.name}`, await post(leg.fillsSubgraphUrl, historyQuery(BOOK.positionId, 25)));
  write(
    `pool-${leg.name}`,
    await post(leg.referencePoolSubgraphUrl, swapsQuery(leg.referencePool, 1000)),
  );
  const ref = await fetchRef(leg, BOOK.positionId);
  if (ref.value === null) throw new Error(`${leg.name}: ${ref.error}`);
  write(`ref-${leg.name}`, stringifyBigints(ref.value));
}

write("recorded-at", { seconds: Math.floor(Date.now() / 1000) });
