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

/**
 * One query, with backoff.
 *
 * Recording is six queries in a few seconds, two of them asking for a thousand swaps, and Subgraph
 * Studio rate-limits that. Its refusal is plain text, so parsing the body as JSON first reports it
 * as `SyntaxError: Unexpected identifier "Too"` — an error about the recorder rather than about the
 * endpoint. Read the status, say what happened, and wait.
 */
const post = async (url: string, body: string, attempt = 0): Promise<unknown> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: `{ _meta { hasIndexingErrors } ${body} }` }),
  });

  if (response.status === 429 || response.status >= 500) {
    if (attempt >= 5) throw new Error(`${url} kept answering ${response.status}`);
    const wait = 2 ** attempt * 1000;
    console.log(`  ${response.status} from the endpoint; waiting ${wait}ms`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return post(url, body, attempt + 1);
  }

  const text = await response.text();
  let payload: { data?: unknown; errors?: unknown };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new Error(`${url} answered ${response.status} with non-json: ${text.slice(0, 120)}`);
  }
  if (payload.data === undefined) throw new Error(`${url}: ${JSON.stringify(payload.errors)}`);
  return payload.data;
};

const stringifyBigints = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

for (const leg of LEGS) {
  write(`history-${leg.name}`, await post(leg.fillsSubgraphUrl, historyQuery(BOOK.positionId, 25)));
  write(
    `pool-${leg.name}`,
    await post(leg.referencePoolSubgraphUrl, swapsQuery(leg.referencePool, 1000)),
  );
  const ref = await fetchRef(leg, BOOK.positionId);
  if (ref.value === null) throw new Error(`${leg.name}: ${ref.error}`);
  write(`ref-${leg.name}`, stringifyBigints(ref.value));
  // Spaced out: six queries in a few seconds, two of them asking for a thousand swaps, is what the
  // endpoint refuses.
  await pause(1500);
}

write("recorded-at", { seconds: Math.floor(Date.now() / 1000) });
