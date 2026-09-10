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
/** What an endpoint has left, read off the headers of whatever answer it just gave. */
const headroom = (response: Response): string => {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  if (remaining === null) return "";
  const at = reset === null ? "" : new Date(Number(reset) * 1000).toISOString().slice(11, 16);
  return `  [${remaining} left${at === "" ? "" : `, resets ${at}Z`}]`;
};

const post = async (url: string, body: string, attempt = 0): Promise<unknown> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: `{ _meta { hasIndexingErrors } ${body} }` }),
  });

  if (response.status === 429 || response.status >= 500) {
    // The allowance is per deployment endpoint, not per account, and its window is hours. Backing
    // off is pointless against that, so say when it resets and give up on this endpoint.
    if (response.status === 429) {
      throw new Error(`${url} is out of allowance${headroom(response)}`);
    }
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
  console.log(`  read ${new URL(url).pathname.split("/").slice(-2, -1)[0]}${headroom(response)}`);
  return payload.data;
};

const stringifyBigints = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Which legs to record. `bun run scripts/record.ts sepolia` refreshes one.
 *
 * One leg at a time matters because the allowance is per deployment endpoint: the three fills
 * subgraphs run out at different times, so "the quota is exhausted" is rarely true of all of them
 * at once, and a run that insists on all three waits for the slowest.
 */
const wanted = process.argv.slice(2);
const chosen = wanted.length === 0 ? LEGS : LEGS.filter((leg) => wanted.includes(leg.name));
if (chosen.length === 0) {
  throw new Error(`no leg matches ${wanted.join(", ")}; known: ${LEGS.map((l) => l.name).join(", ")}`);
}
console.log(`recording ${chosen.map((l) => l.name).join(", ")}`);

for (const leg of chosen) {
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

// Only stamped when every leg was refreshed: a partial run leaves the previous stamp, so the
// fixtures never claim to be more recent than their oldest part.
if (chosen.length === LEGS.length) {
  write("recorded-at", { seconds: Math.floor(Date.now() / 1000) });
} else {
  console.log("partial run: recorded-at left as it was");
}
