/**
 * Numbers as an operator says them, and never without their scale.
 *
 * `tiltBps` is basis points at BPS = 10,000 and sits next to fee figures at 1e7 and rate opcodes at
 * 1e18, so a bare number on this screen is a number that can be read three ways. Everything here
 * returns its unit with it.
 */
export const signedBps = (bps: number): string => `${bps > 0 ? "+" : bps < 0 ? "−" : ""}${Math.abs(bps)}`;

/** A raw token amount as a decimal, to a few significant places rather than all eighteen. */
export function tokenAmount(raw: string, decimals: number, places = 6): string {
  const value = Number(BigInt(raw)) / 10 ** decimals;
  if (value === 0) return "0";
  const magnitude = Math.max(0, places - 1 - Math.floor(Math.log10(Math.abs(value))));
  return value.toFixed(Math.min(12, magnitude)).replace(/\.?0+$/, "");
}

/** A mid as USDC per WETH, which is how every other surface says it. */
export const midAsPrice = (mid: string): string => {
  // Raw token-B per 1e18 raw token-A, six-decimal A against eighteen-decimal B.
  const perA = Number(BigInt(mid)) / 1e18;
  if (perA === 0) return "—";
  return (1e12 / perA).toLocaleString("en-US", { maximumFractionDigits: 0 });
};

/** A transaction, short enough for a column and long enough to find on an explorer. */
export const shortHash = (hash: string): string => `${hash.slice(0, 10)}…${hash.slice(-6)}`;

/** A moment, as the clock the replay runs on. */
export const clock = (atSeconds: number): string =>
  new Date(atSeconds * 1000).toISOString().slice(5, 16).replace("T", " ");

export const ago = (fromSeconds: number, toSeconds: number): string => {
  const seconds = Math.max(0, toSeconds - fromSeconds);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  return hours < 24 ? `${hours}h${Math.floor((seconds % 3600) / 60)}m` : `${Math.floor(hours / 24)}d${hours % 24}h`;
};
