import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOOK, LEGS } from "../src/config.js";
import { historyQuery } from "../src/fills.js";
import { swapsQuery } from "../src/pool.js";
import { momentProblems } from "../src/moment.js";
import { fetchRef } from "../src/registry.js";
import { fetchWallet } from "../src/wallet.js";
import { homedir } from "node:os";
import { QUOTE_API_URL } from "../src/quotes.js";
import { markHistoryUrl } from "../src/market.js";

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
/**
 * How far back a recording reaches.
 *
 * The console asks for twenty-five of each, which is what its feed can draw. A recording is read
 * once and replayed afterwards, so it is worth more: at a publish about every five minutes,
 * twenty-five references cover under two hours — a window that contained no fill at all, which left
 * the web replay drawing a shift with nothing happening to it. Four hundred covers about thirty
 * hours, which holds a day's fills inside the window they are plotted against and leaves room for
 * the recording to age before that stops being true.
 *
 * It costs nothing extra. Subgraph Studio bills a query, not a row.
 */
const DEPTH = 400;

/**
 * The two windows of the market series that are recorded.
 *
 * A week, hourly, is what the chart opens on; six hours comes back per swap, and the two are not
 * the same shape — an hourly series drawn over six hours is a handful of points joined by straight
 * lines, which is not what the market did. Both are recorded so a surface can show either without
 * asking the service anything.
 */
const MARKET_WINDOWS = [168, 6] as const;

/**
 * The quoted size, which is the console's own: 0.15 USDC, and the WETH the mark says that is.
 *
 * The B side is derived from the mark at the moment of recording rather than written down, so the
 * two sides of the recorded quote are the same size in opposite directions and neither is a number
 * somebody chose.
 */
const QUOTE_SIZE_A = 150_000n;

/** A plain GET against the quote service, which answers json and is not rate limited. */
const get = async (url: string): Promise<unknown> => {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} answered ${response.status}: ${text.slice(0, 120)}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${url} answered ${response.status} with non-json: ${text.slice(0, 120)}`);
  }
};

/**
 * The quote service's own answers: both sides of a quote, the mark, and the market series.
 *
 * These are what the recorded moment was missing. Everything else on the console's screen — the
 * shift, the spread, the PnL — is computed here from recorded chain state, but the quoted price is
 * the router's answer through the service that rebuilds the order, and the mark is a mainnet price.
 * Neither can be derived from a subgraph fixture, so a surface replaying the moment either records
 * them or invents them.
 *
 * No indexer allowance is spent: this is the maker's own service.
 */
/**
 * The pushes this machine made, copied out of its own transaction log.
 *
 * Hold is the price move on the inventory a leg holds, and inventory arrives in parcels: the side
 * it was shipped with, and every push since. Valuing a push needs the mark on the day it landed, so
 * the recording has to carry when each one happened and how much it moved — the chain has the
 * transaction, but not in any form a fixture can read without an archive node.
 *
 * The file is the operator's, at `~/.zentis/txlog.jsonl` or wherever `ZENTIS_TXLOG` says, and it is
 * the same file the console's log page draws. Only the pushes are copied, and only their public
 * facts. Nothing is written when the file is absent: a recording made on a machine that never
 * pushed simply has no parcels to add, and hold then says so for itself.
 */
const recordPushes = () => {
  const path = process.env["ZENTIS_TXLOG"] ?? join(homedir(), ".zentis", "txlog.jsonl");
  let lines: string[];
  try {
    lines = readFileSync(path, "utf8").split("\n");
  } catch {
    console.log(`  no transaction log at ${path}; recording no pushes`);
    return;
  }
  const pushes = lines
    .flatMap((line) => {
      if (line.trim() === "") return [];
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    })
    .filter((row) => row["kind"] === "push" && row["status"] !== 0)
    .map((row) => ({
      at: String(row["at"] ?? ""),
      atSeconds: Math.floor(Date.parse(String(row["at"] ?? "")) / 1000) || null,
      chain: String(row["chain"] ?? ""),
      chainId: typeof row["chainId"] === "number" ? row["chainId"] : null,
      token: String(row["tokenIn"] ?? ""),
      amount: String(row["amountIn"] ?? ""),
      tx: String(row["tx"] ?? ""),
      note: row["note"] === undefined || row["note"] === null ? null : String(row["note"]),
    }))
    .filter((push) => push.atSeconds !== null && push.amount !== "" && push.token !== "");
  write("pushes", { source: path.replace(homedir(), "~"), pushes });
};

const recordService = async () => {
  const mark = (await get(`${QUOTE_API_URL}/mark`)) as { marks: { chainId: number; mid: string | null }[] };
  write("mark", mark);
  const mid = mark.marks.find((m) => m.mid !== null)?.mid ?? null;
  if (mid === null) throw new Error("the quote service returned no mark, so the B side has no size");
  // mid is raw tokenB per 1e18 raw tokenA, so this is the same size the other way round.
  const sizeB = (QUOTE_SIZE_A * BigInt(mid)) / 10n ** 18n;
  write("quote-sizes", { amountInA: String(QUOTE_SIZE_A), amountInB: String(sizeB), markMid: mid });
  for (const [side, amount] of [
    ["AtoB", QUOTE_SIZE_A],
    ["BtoA", sizeB],
  ] as const) {
    const url = `${QUOTE_API_URL}/quote?positionId=${BOOK.positionId}&amountIn=${amount}&side=${side}`;
    write(`quotes-${side.toLowerCase()}`, await get(url));
  }
  for (const hours of MARKET_WINDOWS) {
    write(`market-${hours}h`, await get(markHistoryUrl(hours)));
  }
  recordPushes();
};

const wanted = process.argv.slice(2);
// `wallet` alone records just the maker's wallet, which is RPC only. That matters when an indexer's
// allowance is spent: the wallet can still be captured without asking a subgraph anything.
const walletOnly = wanted.length === 1 && wanted[0] === "wallet";
// `service` alone records the quote service's answers, which cost no indexer allowance at all.
const serviceOnly = wanted.length === 1 && wanted[0] === "service";
if (serviceOnly) {
  await recordService();
  console.log("OK: recorded the quote service's quotes, mark and market series");
  process.exit(0);
}
const chosen = wanted.length === 0 || walletOnly ? (walletOnly ? [] : LEGS) : LEGS.filter((leg) => wanted.includes(leg.name));
if (chosen.length === 0 && !walletOnly) {
  throw new Error(`no leg matches ${wanted.join(", ")}; known: ${LEGS.map((l) => l.name).join(", ")}`);
}
console.log(walletOnly ? "recording the maker's wallet" : `recording ${chosen.map((l) => l.name).join(", ")}`);

for (const leg of chosen) {
  write(`history-${leg.name}`, await post(leg.fillsSubgraphUrl, historyQuery(BOOK.positionId, DEPTH)));
  // Only for a leg that still has a venue. Two of the three reference pools were retired when the
  // book moved to one mainnet mid, and a recorder that insisted on them would either crash or write
  // a week-old price as though it were current.
  if (leg.referencePool !== null && leg.referencePoolSubgraphUrl !== null) {
    write(`pool-${leg.name}`, await post(leg.referencePoolSubgraphUrl, swapsQuery(leg.referencePool, 1000)));
  } else {
    console.log(`  ${leg.name} has no reference pool; nothing to record for it`);
  }
  const ref = await fetchRef(leg, BOOK.positionId);
  if (ref.value === null) throw new Error(`${leg.name}: ${ref.error}`);
  write(`ref-${leg.name}`, stringifyBigints(ref.value));
  // Spaced out: six queries in a few seconds, two of them asking for a thousand swaps, is what the
  // endpoint refuses.
  await pause(1500);
}

// The maker's wallet, over RPC only: no indexer allowance is spent on it, and it is the one part of
// the recorded moment the screen has never drawn from anything real. Recorded whole rather than per
// leg, because "held, committed, free" is a statement about one wallet across three chains.
if (chosen.length === LEGS.length || walletOnly) {
  const wallet = await fetchWallet(LEGS, BOOK.maker);
  write("wallet", {
    maker: wallet.maker,
    chains: wallet.chains.map((chain) => ({
      chainId: chain.chainId,
      chain: chain.chain,
      gas: String(chain.gas),
      // Recorded as what was read, not as what was derived: free, shortfall and whether the approval
      // still covers the commitment are recomputed by the same function the live path uses.
      tokenA: {
        symbol: chain.tokenA.symbol,
        decimals: chain.tokenA.decimals,
        held: String(chain.tokenA.held),
        committed: String(chain.tokenA.committed),
        allowance: String(chain.tokenA.allowance),
      },
      tokenB: {
        symbol: chain.tokenB.symbol,
        decimals: chain.tokenB.decimals,
        held: String(chain.tokenB.held),
        committed: String(chain.tokenB.committed),
        allowance: String(chain.tokenB.allowance),
      },
    })),
  });
  for (const caveat of wallet.caveats) console.log(`  wallet: ${caveat}`);
}

// The service's answers, whenever the whole moment is being refreshed: a recorded moment whose
// quotes came from a different hour than its balances is two moments on one screen.
if (chosen.length === LEGS.length && !walletOnly) {
  await recordService();
}

// Only stamped when every leg was refreshed: a partial run leaves the previous stamp, so the
// fixtures never claim to be more recent than their oldest part.
if (chosen.length === LEGS.length && !walletOnly) {
  write("recorded-at", { seconds: Math.floor(Date.now() / 1000) });
} else {
  console.log("partial run: recorded-at left as it was");
}

/**
 * Check what was just written, and say so in one line.
 *
 * This runs unattended from a timer at an hour nobody is watching, and its output is read hours
 * later. A run that half-succeeded — an endpoint that answered with an empty `position`, a file
 * written truncated — would otherwise look identical in the log to one that worked, and the failure
 * would surface as a broken test the next morning with no clue which leg was at fault.
 */
const problems: string[] = [];
if (walletOnly) {
  const recorded = JSON.parse(readFileSync(join(dir, "wallet.json"), "utf8")) as { chains?: unknown[] };
  if ((recorded.chains ?? []).length !== LEGS.length) problems.push("wallet: not every chain answered");
  if (problems.length > 0) {
    console.error(`FAILED: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log(`OK: recorded the maker's wallet on ${LEGS.length} chain(s)`);
  process.exit(0);
}
for (const leg of chosen) {
  for (const [name, expect] of [
    ...(leg.referencePool === null
      ? []
      : ([[`pool-${leg.name}`, (d: Record<string, unknown>) => Array.isArray(d["swaps"]) && (d["swaps"] as unknown[]).length > 0]] as const)),
    [`ref-${leg.name}`, (d: Record<string, unknown>) => Number(d["seq"]) > 0],
  ] as const) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as Record<string, unknown>;
      if (!expect(parsed)) problems.push(`${name}: written but does not carry what it should`);
    } catch (cause) {
      problems.push(`${name}: ${String(cause)}`);
    }
  }
}

const read = (name: string) => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
const recorded = chosen.map((leg) => ({
  name: leg.name,
  history: read(`history-${leg.name}`),
  ref: read(`ref-${leg.name}`),
}));
problems.push(...momentProblems(recorded, LEGS.length));
const seqs = new Set(recorded.map((leg) => Number(leg.ref.seq)));

if (problems.length > 0) {
  console.error(`FAILED: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`OK: recorded ${chosen.length} leg(s), seq ${[...seqs].join(", ")}`);
