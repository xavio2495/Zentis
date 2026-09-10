/**
 * What the console waits to see after an action that writes.
 *
 * `seqBefore` is the book's seq at the moment the operator confirmed, captured before the command
 * ran so that the comparison is against the state the action was taken from.
 */
export interface Pending {
  readonly label: string;
  readonly seqBefore: number | null;
}

/**
 * The line to show when a write has actually landed, or null while it has not.
 *
 * A clean exit is not evidence: the simulator prints a green result and exits zero even when the
 * forwarder rejected the report, which is why the actions row says "finished" and not "succeeded".
 * The evidence is the next poll seeing a seq the book did not have before — that number comes off
 * the registries themselves, so it is the one confirmation the console can vouch for.
 *
 * A null `seq` means the legs are on different references, and announcing a landing then would
 * claim the book republished when only part of it did.
 */
export function landed(pending: Pending | null, seq: number | null): string | null {
  if (pending === null || seq === null) return null;
  if (pending.seqBefore !== null && seq <= pending.seqBefore) return null;
  return `seq ${seq} landed — ${pending.label}`;
}
