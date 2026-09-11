/**
 * One turning mark, for a panel that is waiting.
 *
 * Braille dots rather than a line of ASCII slashes: they are a single cell wide in every font a
 * terminal is run in, and the shape reads as motion rather than as a character changing.
 *
 * The frame is a function of the clock, not of the render, because this console repaints when its
 * data changes and a spinner that only moved on a repaint would stand still exactly while the thing
 * it is waiting for is slow.
 */
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** How often the mark advances. Slow enough not to flicker, fast enough to look alive. */
export const SPINNER_MS = 120;

export const spinnerFrame = (tick: number): string => SPINNER[((tick % SPINNER.length) + SPINNER.length) % SPINNER.length]!;

/** The frame for a moment in time, so every spinner on screen turns together. */
export const spinnerAt = (milliseconds: number): string => spinnerFrame(Math.floor(milliseconds / SPINNER_MS));
