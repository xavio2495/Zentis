import { readFileSync, statSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Address, type Hex, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LEGS, type LegConfig } from "@zentis/console-data";
import { type Request, approveRequest, pushRequest, quoteRequest, swapRequest, tokenIn, wrapRequest } from "./intents.js";

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
  | { kind: "wallet-new"; path?: string };

const KINDS = ["approve", "fill", "push", "wallet-new"];

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
export function redact(text: string, key?: string): string {
  let out = text;
  if (key !== undefined && key !== "") {
    out = out.split(key).join("[redacted]");
    const bare = key.startsWith("0x") ? key.slice(2) : key;
    out = out.split(bare).join("[redacted]");
  }
  return out.replace(/0x[0-9a-fA-F]{64}\b/g, (match) => (match.length === 66 ? "[redacted]" : match));
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

export async function runIntent(
  intent: Intent,
  envPath: string,
  log: (line: string) => void,
  /** injected by the tests, which pin the sequence rather than the chain */
  transport?: Transport,
): Promise<void> {
  if (intent.kind === "wallet-new") throw new Error("wallet-new is not implemented yet");

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
  const send = async (what: string, request: Request): Promise<void> => {
    nonce ??= await reader.getTransactionCount({ address: account.address, blockTag: "pending" });
    const hash = await wallet.sendTransaction({ ...request, chain: null, account, nonce });
    nonce += 1;
    const receipt = await reader.waitForTransactionReceipt({ hash });
    log(`${what} ${hash} ${receipt.status}`);
    if (receipt.status !== "success") throw new Error(`${what} reverted`);
  };

  if (intent.kind === "approve") {
    await send("approved", approveRequest(intent.token, intent.spender, BigInt(intent.amount)));
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
      await send("approved", approveRequest(input.address, leg.fill!.router as Address, amountRaw));
    }

    await send("filled", swapRequest(leg, params));
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
    if (wrap > 0n) await send("wrapped", wrapRequest(leg.tokenB.address, wrap));
    if (intent.needsApproval) {
      await send("approved", approveRequest(leg.tokenB.address, leg.aqua, BigInt(intent.approval)));
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
    );
    return;
  }

  throw new Error("that intent is not implemented yet");
}

/** The entry point `zentis sign` runs: intent on stdin, one line per step on stdout. */
export async function signMain(stdin: string, envPath: string | null): Promise<number> {
  let key: string | undefined;
  try {
    if (envPath === null) throw new Error("no env file: set ZENTIS_ENV or run the console's onboarding");
    const intent = parseIntent(stdin);
    await runIntent(intent, envPath, (line) => process.stdout.write(`${redact(line, key)}\n`));
    return 0;
  } catch (cause) {
    process.stderr.write(`${redact(String(cause instanceof Error ? cause.message : cause), key)}\n`);
    return 1;
  }
}
