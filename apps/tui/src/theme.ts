/**
 * One colour per term, everywhere that term appears.
 *
 * The screen shows the same quantity in three places — a gauge, a stacked bar, a feed row — and a
 * reader who has to relearn the mapping in each place is reading three screens. So the colour is
 * attached to the *meaning*, not to the widget: correction is this cyan in the gauge, in the leg
 * header and in the feed, and nothing else is.
 *
 * Placeholder values, chosen only to be distinguishable at 720p on a dark terminal, pending the
 * project's branding.
 */
export const TERM = {
  /** the anchor: putting this curve back on the mid */
  correction: "#5fd7ff",
  /** the own-leg skew: this leg paying to shed what it holds */
  concession: "#ff87d7",
  /** the book skew: the same concession charged across the whole book */
  bookConcession: "#8787ff",
  /** the base half-spread the workflow is configured with */
  base: "#9e9e9e",
  volatility: "#ffd75f",
  markout: "#ff5f5f",
  staleness: "#ff8700",
  /** the boundary, and the room left inside it */
  boundary: "#5fd75f",
} as const;

export const UI = {
  frame: "#5f5f5f",
  heading: "#ffffff",
  muted: "#8a8a8a",
  /** a fill: the only event on this screen that moved value */
  fill: "#5fd75f",
  reference: "#5fd7ff",
  rejection: "#ff5f5f",
  /** something the operator should read before trusting the number next to it */
  caveat: "#ffd75f",
  disabled: "#5f5f5f",
  action: "#ffffff",
} as const;

/** Filled and empty cells for the inventory and weight bars. */
export const BAR = { filled: "█", empty: "░", marker: "│" } as const;

/**
 * One colour per leg, carried through its card, its chart line and its feed rows.
 *
 * Keyed on chain id rather than on position in a list, so a reordered display or a fourth leg
 * cannot silently reassign an identity the reader has already learned. Hues follow the user's
 * wireframe; like the terms above they are placeholders until branding arrives.
 */
export const LEG = {
  // Three hues that mean nothing else on this screen. The first set used red for Sepolia — the
  // colour of a rejected row — and grey for Arbitrum, the colour of a disabled key, so a leg's own
  // name read as a fault. Red, yellow, green and grey are reserved for state; a test holds the line.
  11155111: "#b48cff", // Sepolia — violet
  84532: "#4f8cff", // Base Sepolia — blue
  421614: "#2fb3a0", // Arbitrum Sepolia — teal
} as const

/** The order the wireframe stacks them in, top to bottom. */
export const LEG_ORDER = [11155111, 84532, 421614] as const

export const legColour = (chainId: number): string =>
	(LEG as Record<number, string>)[chainId] ?? UI.heading

/** A leg's one-word state, and the colour that carries it. */
export const STATE = {
	live: UI.fill,
	stale: TERM.staleness,
	refusing: UI.rejection,
	docked: UI.disabled,
} as const
