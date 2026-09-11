import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * Where this console keeps a key, and how one comes to exist.
 *
 * A stranger installing the binary has no env file and no reason to write one. The console makes a
 * wallet for them, in the only process that ever touches a key, and writes it where nothing else on
 * the machine can read it. What comes back to the caller is the address — public by definition —
 * and the path. The key itself never leaves this function.
 */
export const configDir = (home: string = homedir()): string => join(home, ".zentis");

export const walletPath = (home: string = homedir()): string => join(configDir(home), "wallet.env");

const configPath = (home: string): string => join(configDir(home), "config.json");

export interface CreatedWallet {
  readonly address: `0x${string}`;
  readonly path: string;
  /** the mode the file was created with, so the screen can state it rather than promise it */
  readonly mode: string;
}

export function createWallet(home: string = homedir()): CreatedWallet {
  const path = walletPath(home);
  // Never overwritten. A second wallet where one already exists would strand whatever the first one
  // holds — funded, approved, and now unreachable.
  if (existsSync(path)) throw new Error(`${path} already exists; this console will not replace a wallet`);

  // 0o700 on the directory as well: a key file only its owner can read, inside a directory anyone
  // can list, still tells the machine that this user has a wallet and where.
  mkdirSync(configDir(home), { recursive: true, mode: 0o700 });
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  writeFileSync(path, `TAKER_PRIVATE_KEY=${key}\n`, { mode: 0o600 });
  return { address: account.address, path, mode: "600" };
}

/**
 * Which env file this console should use, in the order a reader would expect.
 *
 * What they told it this run, then what they told it on an earlier one, then the wallet it made for
 * them. Null is watch-only, which is a legitimate answer rather than a failure.
 */
export function resolveEnvPath(home: string = homedir(), explicit: string | undefined = process.env["ZENTIS_ENV"]): string | null {
  if (explicit !== undefined && explicit !== "") return explicit;

  const config = configPath(home);
  if (existsSync(config)) {
    try {
      const remembered = (JSON.parse(readFileSync(config, "utf8")) as { envPath?: string }).envPath;
      if (remembered !== undefined && remembered !== "" && existsSync(remembered)) return remembered;
    } catch {
      // A config file that cannot be read is not a reason to refuse to start: the wallet below it,
      // or watch-only, is still a working console.
    }
  }

  const wallet = walletPath(home);
  return existsSync(wallet) ? wallet : null;
}

/** Remember an env file the operator chose, so it is not asked for again. */
export function rememberEnvPath(path: string, home: string = homedir()): void {
  mkdirSync(configDir(home), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(home), `${JSON.stringify({ envPath: path }, null, 2)}\n`, { mode: 0o600 });
}
