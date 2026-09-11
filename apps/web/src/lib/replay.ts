/**
 * The replay, as arithmetic.
 *
 * One integer playhead; everything else is derived from it. That is the shape the reference uses
 * and the reason its terminal is a couple of hundred lines rather than a state machine: there is
 * exactly one piece of state a bug can be in.
 *
 * Kept apart from React so that what the transport means can be tested without mounting anything.
 * Nothing here reads a chain or a clock — the rounds are the recorded ones, in the order they were
 * published.
 */
export interface Round {
  readonly seq: number;
  readonly atSeconds: number;
  /** the signed shift the enclave published for this leg, in basis points */
  readonly tiltBps: number;
  /** raw token-B per 1e18 raw token-A, as a decimal string */
  readonly mid: string;
}

export interface Fill {
  readonly atSeconds: number;
  readonly transaction: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly isAToB: boolean;
  /** what the leg was quoting when it was taken */
  readonly refTiltBps: number;
}

export interface Leg {
  readonly chainId: number;
  readonly name: string;
  readonly label: string;
  readonly strategyHash: string;
  /** the leg's own band edge, read off the position rather than assumed */
  readonly maxTiltBps: number;
  readonly rounds: Round[];
  readonly fills: Fill[];
  readonly rejections: { atSeconds: number; transaction: string; reason: string }[];
}

export interface Replay {
  readonly provenance: { recordedAtSeconds: number; sources: string[]; note: string };
  readonly legs: Leg[];
}

/** Everything published up to and including the playhead. Past the end is the end. */
export const visible = <T>(rounds: readonly T[], playhead: number): T[] =>
  rounds.slice(0, Math.max(0, Math.min(playhead, rounds.length - 1)) + 1);

/** The round the playhead is on, or null when there is nothing to be on. */
export const at = <T>(rounds: readonly T[], playhead: number): T | null =>
  rounds.length === 0 ? null : (rounds[Math.max(0, Math.min(playhead, rounds.length - 1))] ?? null);

export type BandState = "in band" | "near edge" | "clamped";

/**
 * Where a shift stands against its leg's own cap.
 *
 * Against the leg's cap and never a fixed number: −500 on a leg capped at 500 is a limit, and −500
 * on a leg capped at 5,000 is an ordinary quote. "Near edge" is the last tenth before the cap,
 * which is the warning the reference gives a whole state to.
 */
export function bandState(tiltBps: number, maxTiltBps: number): BandState {
  const room = Math.abs(tiltBps) / Math.max(1, maxTiltBps);
  if (room >= 1) return "clamped";
  return room >= 0.9 ? "near edge" : "in band";
}

/** The first round this leg spent sitting on its cap, which is the thing worth jumping to. */
export function firstClamp(leg: Leg): number | null {
  const index = leg.rounds.findIndex((round) => bandState(round.tiltBps, leg.maxTiltBps) === "clamped");
  return index === -1 ? null : index;
}

/**
 * Speed as a stride over the same tick.
 *
 * Changing the interval instead would make the clock itself run at four different rates; striding
 * the index keeps one timer and one cadence, and the screen simply skips rounds.
 */
export const SPEEDS = [
  { label: "1×", stride: 1 },
  { label: "2×", stride: 3 },
  { label: "4×", stride: 6 },
  { label: "8×", stride: 12 },
] as const;

/** The stride for a multiplier, or one for a multiplier nobody offers. */
export const strideFor = (multiplier: number): number => {
  const found = SPEEDS.find((speed) => speed.label === `${multiplier}×`);
  return found?.stride ?? 1;
};

/** How often the playhead advances. One cadence, whatever the speed. */
export const TICK_MS = 90;
