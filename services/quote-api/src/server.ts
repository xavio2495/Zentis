import { CHAINS, PORT, REFERENCE_WARN_AGE_SECONDS } from "./config.js";
import { fetchLeg, type LegResult } from "./legs.js";
import { QuoteRefused, quoteLeg } from "./quote.js";
import { explain } from "./reason.js";

interface LegQuote {
  chainId: number;
  chain: string;
  rank: number | null;
  tokenIn: string | null;
  tokenOut: string | null;
  amountIn: string;
  amountOut: string | null;
  reason: string | null;
  seq: number | null;
  tiltBps: number | null;
  refMid: string | null;
  refAgeSeconds: number | null;
  caveats: string[];
  _meta: unknown;
}

function legCaveats(leg: LegResult, nowSeconds: number): string[] {
  const caveats: string[] = [];
  if (leg.error !== null) caveats.push(`subgraph unavailable: ${leg.error}`);
  if (leg.meta?.hasIndexingErrors === true) {
    caveats.push("the indexer reports indexing errors, so this leg's state may be incomplete");
  }
  const position = leg.position;
  if (position === null) return caveats;

  if (!position.active) caveats.push("this leg is docked, so it holds no committed balance");
  if (!position.hasReference) {
    caveats.push("no reference has been published for this leg");
  } else if (position.refUpdatedAt !== null) {
    const age = nowSeconds - Number(position.refUpdatedAt);
    if (age > position.maxStalenessSeconds) {
      caveats.push(
        `the reference is ${age}s old, past this leg's limit of ${position.maxStalenessSeconds}s, so the router will refuse to price`
      );
    } else if (age > REFERENCE_WARN_AGE_SECONDS) {
      caveats.push(`the reference is ${age}s old and the quoted spread has widened with its age`);
    }
  }
  return caveats;
}

async function buildQuote(
  leg: LegResult,
  amountIn: bigint,
  isAToB: boolean,
  nowSeconds: number
): Promise<LegQuote> {
  const caveats = legCaveats(leg, nowSeconds);
  const position = leg.position;

  const base: LegQuote = {
    chainId: leg.chain.chainId,
    chain: leg.chain.name,
    rank: null,
    tokenIn: position === null ? null : isAToB ? position.tokenA : position.tokenB,
    tokenOut: position === null ? null : isAToB ? position.tokenB : position.tokenA,
    amountIn: amountIn.toString(),
    amountOut: null,
    reason: position === null ? null : explain(position, isAToB),
    seq: position?.refSeq ?? null,
    tiltBps: position?.refTiltBps ?? null,
    refMid: position?.refMid ?? null,
    refAgeSeconds:
      position?.refUpdatedAt == null ? null : nowSeconds - Number(position.refUpdatedAt),
    caveats,
    _meta: leg.meta
  };

  if (position === null) {
    caveats.push("this leg has no such position");
    return base;
  }

  try {
    const outcome = await quoteLeg(leg.chain, position.app, position.strategy, amountIn, isAToB);
    return { ...base, amountOut: outcome.amountOut.toString() };
  } catch (cause) {
    if (cause instanceof QuoteRefused) {
      caveats.push(`the router refused this quote: ${cause.message}`);
    } else {
      caveats.push(`could not reach a node for this chain: ${String(cause)}`);
    }
    return base;
  }
}

async function handleQuote(url: URL): Promise<Response> {
  const positionId = url.searchParams.get("positionId");
  const amountRaw = url.searchParams.get("amountIn");
  const side = (url.searchParams.get("side") ?? "AtoB").toLowerCase();

  if (positionId === null || amountRaw === null) {
    return json({ error: "positionId and amountIn are both required" }, 400);
  }
  if (side !== "atob" && side !== "btoa") {
    return json({ error: "side must be AtoB or BtoA" }, 400);
  }
  let amountIn: bigint;
  try {
    amountIn = BigInt(amountRaw);
  } catch {
    return json({ error: "amountIn must be an integer in the token's own units" }, 400);
  }
  if (amountIn <= 0n) return json({ error: "amountIn must be greater than zero" }, 400);

  const isAToB = side === "atob";
  const nowSeconds = Math.floor(Date.now() / 1000);

  const legs = await Promise.all(CHAINS.map((chain) => fetchLeg(chain, positionId)));
  const quotes = await Promise.all(legs.map((leg) => buildQuote(leg, amountIn, isAToB, nowSeconds)));

  const priced = quotes.filter((q) => q.amountOut !== null);
  priced.sort((a, b) => (BigInt(b.amountOut!) > BigInt(a.amountOut!) ? 1 : -1));
  priced.forEach((quote, index) => {
    quote.rank = index + 1;
  });

  const caveats: string[] = [];
  const outTokens = new Set(quotes.map((q) => q.tokenOut).filter((t) => t !== null));
  if (outTokens.size > 1) {
    caveats.push(
      "the legs pay out in different token contracts, so their amounts are ranked but are not directly comparable"
    );
  }
  if (priced.length < quotes.length) {
    caveats.push("at least one leg could not be priced; see its own caveats");
  }

  return json({
    positionId,
    side: isAToB ? "AtoB" : "BtoA",
    amountIn: amountIn.toString(),
    quotes,
    caveats
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/quote") return handleQuote(url);
    if (url.pathname === "/health") return json({ ok: true, chains: CHAINS.map((c) => c.name) });
    return json({ error: "not found" }, 404);
  }
});

console.log(`quote-api listening on http://localhost:${server.port}`);
