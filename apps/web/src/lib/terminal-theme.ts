/**
 * The one colour table that cannot read the sheet.
 *
 * xterm.js is handed hexes at construction and has no way to resolve a custom property, so the
 * terminal's four colours have to exist twice. Keeping them here rather than inline in the
 * component is what makes the duplication checkable: `tests/console-skin.test.ts` reads
 * `globals.css` and compares, so the copy cannot drift away from the original in silence.
 */
export const TERMINAL_THEME = {
  background: "#0a0a0a",
  foreground: "#f5f5f5",
  cursor: "#00ED64",
  /** the accent at 20%: a selection is a highlight of the accent, never a second green */
  selectionBackground: "#00ED6433",
} as const;
