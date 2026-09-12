import { readFileSync, statSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Address, type Hex, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LEGS, type LegConfig } from "@zentis/console-data";
import { createWallet } from "./wallet-file.js";
import { type Request, approveRequest, pushRequest, quoteRequest, swapRequest, tokenIn, wrapRequest } from "./intents.js";
import type { TxLogLine } from "./txlog.js";
import { appendTxLog, txlogPath } from "./txlog-file.js";

/**
 * The one process in this console that holds a key.
 *
 * The interactive process never reads the env file. It writes an intent to this child — a child of
 * the same binary, `zentis sign`, with the intent on **stdin** so it is never an argument `ps` could
 * show — and reads back a hash, a status and the amounts. The boundary is the one the old
 * `sh -c 'set -a; . "$1"; …'` pattern gave us, with no external tool that a stranger's device has to
 * have installed.
 *
 * Everything this process prints goes through `redact`. The ways a key escapes are the ways nobody
 * plans for: a transport quoting the request it failed on, a stack with an argument in it, a
 * provider echoing a payload. One funnel, applied to every path out, is cheaper than auditing them.
 */
export type Intent =
  | { kind: "approve"; chainId: number; token: Address; spender: Address; amount: string; keyName?: string }
  | { kind: "fill"; chainId: number; amount: string; isAToB: boolean; keyName?: string }
  | {
      kind: "push";
      chainId: number;
      /** the top-up itself, in the leg's tokenB */
      amount: string;
      /** what the allowance must be afterwards: this push and the settlement after it */
      approval: string;
      /** native to wrap first, when the wallet does not hold enough tokenB free */
      wrap: string;
      needsApproval: boolean;
      keyName?: string;
    }
  | { kind: "wallet-new"; path?: string }
  /** which address this env file's key belongs to; the answer is public, the key is not */
  | { kind: "address"; keyName?: string };

const KINDS = ["approve", "fill", "push", "wallet-new", "address"];

export function parseIntent(text: string): Intent {
  let parsed: { kind?: string };
  try {
    parsed = JSON.parse(text) as { kind?: string };
  } catch {
    throw new Error("the intent was not json; it is read from stdin, one object");
  }
  if (parsed.kind === undefined || !KINDS.includes(parsed.kind)) {
    throw new Error(`unknown intent "${String(parsed.kind)}"; this binary signs ${KINDS.join(", ")}`);
  }
  return parsed as Intent;
}

/**
 * The key, from the file's own variable.
 *
 * The file's mode is checked first: a key in a file the rest of the machine can read is a key that
 * has already been given away, and signing with it would make that irreversible on chain rather
 * than merely true on disk.
 */
export function readKey(path: string, variable: string): string {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`${path} is mode ${mode.toString(8)}; a key file must be 600 or stricter`);
  }
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${variable}=`));
  if (line === undefined) throw new Error(`${path} has no ${variable}`);
  const value = line.slice(variable.length + 1).trim().replace(/^["']|["']$/g, "");
  if (value === "") throw new Error(`${path} has an empty ${variable}`);
  return value.startsWith("0x") ? value : `0x${value}`;
}

/** Anything that looks like a private key, gone — whoever it belongs to. */
export function redact(text: string, key?: string, allow: Iterable<string> = []): string {
  let out = text;
  if (key !== undefined && key !== "") {
    out = out.split(key).join("[redacted]");
    const bare = key.startsWith("0x") ? key.slice(2) : key;
    out = out.split(bare).join("[redacted]");
  }
  // A key and a transaction hash are both thirty-two bytes, so nothing about their shape tells them
  // apart. What does is provenance: the allowance holds the hashes this process was handed back by
  // `sendTransaction`, and every other 32-byte value is treated as a key — which is what an unknown
  // one is. Without this the console could never show a hash, because the funnel ate every one.
  const sent = new Set([...allow].map((hash) => hash.toLowerCase()));
  return out.replace(/0x[0-9a-fA-F]{64}\b/g, (match) =>
    match.length !== 66 || sent.has(match.toLowerCase()) ? match : "[redacted]",
  );
}

const legOf = (chainId: number): LegConfig => {
  const leg = LEGS.find((l) => l.chainId === chainId);
  if (leg === undefined) throw new Error(`no leg is configured for chain ${chainId}`);
  return leg;
};

/** What the child prints: one line per step, and never anything it was given. */
export interface Step {
  readonly what: string;
  readonly hash?: Hex;
  readonly status?: string;
  readonly note?: string;
}

/** The wallet-new intent: made here, in the process that signs, and never anywhere else. */
function newWallet(log: (line: string) => void): void {
  const created = createWallet();
  log(`address ${created.address}`);
  log(`written ${created.path} mode ${created.mode}`);
  log("the key is in that file and will not be shown again");
}

export async function runIntent(
  intent: Intent,
  envPath: string,
  log: (line: string) => void,
  /** injected by the tests, which pin the sequence rather than the chain */
  transport?: Transport,
  /**
   * Filled in with every hash this run sent, so the caller's redactor can let those through and no
   * other 32-byte value. Owned by the caller because the redactor is the caller's.
   */
  sent?: Set<string>,
  /**
   * Where each transaction is written down for anything that reads the machine's log afterwards.
   *
   * This process is the only one that knows a hash the moment it exists, so this process writes the
   * line — the same line the taker and rebalance scripts write into the same file. Passed in rather
   * than opened here so a test journals into an array and never into the operator's own log.
   */
  journal?: (line: TxLogLine) => void,
): Promise<void> {
  if (intent.kind === "wallet-new") {
    newWallet(log);
    return;
  }

  if (intent.kind === "address") {
    // Derived in the process that already holds the key, so the one drawing the screen never has to.
    const account = privateKeyToAccount(readKey(envPath, intent.keyName ?? "TAKER_PRIVATE_KEY") as Hex);
    log(`address ${account.address}`);
    return;
  }

  const leg = legOf(intent.chainId);
  const keyName = intent.keyName ?? (intent.kind === "push" ? "CRE_ETH_PRIVATE_KEY" : "TAKER_PRIVATE_KEY");
  const key = readKey(envPath, keyName);
  const account = privateKeyToAccount(key as Hex);
  const legTransport = transport ?? http(leg.rpcUrl, { timeout: 20_000 });
  const reader = createPublicClient({ transport: legTransport });
  const wallet = createWalletClient({ account, transport: legTransport });

  // Read once and counted from there. Letting each send fetch its own would have three of them race
  // for the same number the moment two are in flight, which is the ordinary way a sequence like this
  // fails on a busy chain.
  let nonce: number | null = null;
  /** What the shared log calls each of the four things this child sends. */
  const LOGGED_AS: Record<string, string> = { approved: "approve", filled: "fill", wrapped: "wrap", pushed: "push" };
  const send = async (
    what: string,
    request: Request,
    /** what moved, for the log line; absent where the kind has no amount of its own */
    moved: { amountIn?: string; tokenIn?: string; amountOut?: string; tokenOut?: string } = {},
  ): Promise<void> => {
    nonce ??= await reader.getTransactionCount({ address: account.address, blockTag: "pending" });
    const hash = await wallet.sendTransaction({ ...request, chain: null, account, nonce });
    // Written down before the line carrying it is printed, so the funnel knows this one is a hash.
    sent?.add(hash);
    nonce += 1;
    const receipt = await reader.waitForTransactionReceipt({ hash });
    log(`${what} ${hash} ${receipt.status}`);
    // A reverted transaction is written down too, and before the throw: it cost gas, it is on chain,
    // and a log holding only the ones that worked is the log you cannot debug a bad evening with.
    journal?.({
      at: new Date().toISOString(),
      chain: leg.name,
      chainId: leg.chainId,
      kind: LOGGED_AS[what] ?? what,
      actor: account.address,
      tx: hash,
      status: receipt.status === "success" ? 1 : 0,
      amountIn: moved.amountIn ?? null,
      amountOut: moved.amountOut ?? null,
      tokenIn: moved.tokenIn ?? null,
      tokenOut: moved.tokenOut ?? null,
      note: null,
    });
    if (receipt.status !== "success") throw new Error(`${what} reverted`);
  };

  if (intent.kind === "approve") {
    await send("approved", approveRequest(intent.token, intent.spender, BigInt(intent.amount)), {
      amountIn: intent.amount,
      tokenIn: intent.token,
    });
    return;
  }

  if (intent.kind === "fill") {
    const amountRaw = BigInt(intent.amount);
    const params = { amountRaw, isAToB: intent.isAToB };
    // What the router says it would do, before anything is sent. An `eth_call` is a static call,
    // which is what `asView()` is in Solidity.
    const before = await reader.call(quoteRequest(leg, params));
    log(`quoted ${before.data ?? "0x"}`);

    const input = tokenIn(leg, intent.isAToB);
    const allowance = await reader.readContract({
      address: input.address,
      abi: (await import("./intents.js")).ERC20_ABI,
      functionName: "allowance",
      args: [account.address, leg.fill!.router as Address],
    });
    if (allowance < amountRaw) {
      await send("approved", approveRequest(input.address, leg.fill!.router as Address, amountRaw), {
        amountIn: amountRaw.toString(),
        tokenIn: input.address,
      });
    }

    // The side that went in is known here; what came back is not, without decoding the receipt's
    // logs. The fills subgraph has both and the log page shows what it has, so the line carries the
    // input and the token it came out in rather than a number this child guessed at.
    const output = tokenIn(leg, !intent.isAToB);
    await send("filled", swapRequest(leg, params), {
      amountIn: amountRaw.toString(),
      tokenIn: input.address,
      tokenOut: output.address,
    });
    // Quoted again, so a swap that did not match what was quoted is visible rather than assumed.
    const after = await reader.call(quoteRequest(leg, params));
    log(`quoted after ${after.data ?? "0x"}`);
    return;
  }

  if (intent.kind === "push") {
    // Wrap, approve, push — in that order, and the approval covers the settlement after the push as
    // well as the push itself. An approval sized to the top-up alone is consumed by it and leaves
    // the leg unable to settle its next fill, which is what happened on 2026-09-11.
    const wrap = BigInt(intent.wrap);
    if (wrap > 0n) {
      await send("wrapped", wrapRequest(leg.tokenB.address, wrap), {
        amountIn: wrap.toString(),
        tokenOut: leg.tokenB.address,
        amountOut: wrap.toString(),
      });
    }
    if (intent.needsApproval) {
      await send("approved", approveRequest(leg.tokenB.address, leg.aqua, BigInt(intent.approval)), {
        amountIn: intent.approval,
        tokenIn: leg.tokenB.address,
      });
    }
    await send(
      "pushed",
      pushRequest(leg.aqua, {
        maker: account.address,
        app: leg.app,
        strategyHash: leg.strategyHash,
        token: leg.tokenB.address,
        amount: BigInt(intent.amount),
      }),
      { amountIn: intent.amount, tokenIn: leg.tokenB.address },
    );
    return;
  }

  throw new Error("that intent is not implemented yet");
}

/** The entry point `zentis sign` runs: intent on stdin, one line per step on stdout. */
export async function signMain(stdin: string, envPath: string | null): Promise<number> {
  let key: string | undefined;
  const sent = new Set<string>();
  try {
    const intent = parseIntent(stdin);
    // Making a wallet is the one intent that needs no key, because it is where one comes from.
    if (intent.kind !== "wallet-new" && envPath === null) {
      throw new Error("no env file: set ZENTIS_ENV or run the console's onboarding");
    }
    // The hashes this run sent, gathered as it sends them: the only 32-byte values allowed out.
    // The shared file, opened here and nowhere else in the child: `runIntent` is handed a function
    // so the tests that drive it write into an array instead of the operator's own log.
    const path = txlogPath();
    await runIntent(
      intent,
      envPath ?? "",
      (line) => process.stdout.write(`${redact(line, key, sent)}\n`),
      undefined,
      sent,
      (entry) => appendTxLog(path, entry),
    );
    return 0;
  } catch (cause) {
    process.stderr.write(`${redact(String(cause instanceof Error ? cause.message : cause), key, sent)}\n`);
    return 1;
  }
}
