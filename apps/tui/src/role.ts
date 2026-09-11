import { BOOK } from "@zentis/console-data";

/**
 * What this console may do, read off the address it holds.
 *
 * Nobody is asked to choose. The maker is an address on chain — the one the positions are shipped
 * under — so a console holding that key is the maker's and can push; any other key is a taker's and
 * can quote and fill; no key at all is a watcher's. A chosen role would be a claim the screen makes
 * about itself, and the first push would find out it was wrong.
 */
export type Role = "maker" | "taker" | "watcher";

export function roleOf(address: string | null): Role {
  if (address === null) return "watcher";
  return address.toLowerCase() === BOOK.maker.toLowerCase() ? "maker" : "taker";
}

/** Why the console is in that role, for the status page. */
export function roleReason(role: Role, address: string | null): string {
  if (role === "watcher") return "no key, so this console reads and never signs";
  if (role === "maker") return `${address ?? ""} is the book's maker, so push is offered`;
  return `${address ?? ""} is not the book's maker, so this console quotes and fills as a taker`;
}
