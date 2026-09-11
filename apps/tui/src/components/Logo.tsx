import { Box, Text } from "ink";
import { LOGO_COMPLETE_MS, logoFrame, logoSize } from "../logo.js";


/**
 * The mark, on the screens that have nothing else to show.
 *
 * Filled cells while it draws itself, then the colours invert — black on the brand green — which is
 * where the file's own animation ends. It holds there and starts again, so a console waiting on a
 * slow chain still looks alive.
 */
export function Logo({
  elapsedMs,
  cols,
  rows,
}: {
  elapsedMs: number;
  /** the space it may use; it takes a square field and gives back what it did not need */
  cols: number;
  rows: number;
}) {
  const { width, height } = logoSize(cols, rows);
  if (width === 0 || height === 0) return null;
  const frame = logoFrame(elapsedMs, width, height);

  return (
    <Box flexDirection="column" width={cols} height={height} alignItems="center" overflow="hidden">
      {frame.rows.map((row, y) => (
        <Box key={y} height={1}>
          {/* Drawn as one string either way. Inverted, the field is the brand green and the mark is
              black on top of it, which is where the file's animation ends. */}
          <Text
            color={frame.inverted ? "black" : frame.colour}
            backgroundColor={frame.inverted ? frame.colour : undefined}
          >
            {row.cells.map((cell) => (cell.on ? "█" : " ")).join("")}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/** How many rows `Logo` will take at this size, so a caller can lay out what goes under it. */
export const logoRows = (cols: number, rows: number): number => logoSize(cols, rows).height;

/**
 * The mark drawn into what a page has left at the bottom of its panel.
 *
 * The pages are tables, and a table that ends halfway down leaves the rest blank; that space is the
 * only place the brand can go without costing a row of anything. Nothing is returned unless the room
 * is genuinely spare — a mark that pushed a number off a page would be a mark in the wrong place.
 *
 * Finished and still, not animated: a page repaints when its data changes, so an animation on one
 * would stop wherever the last poll left it.
 */
export function markRows(width: number, spare: number): React.ReactNode[] {
  const { width: marked, height } = logoSize(width, Math.max(0, spare - 2));
  if (marked === 0 || height === 0) return [];
  const frame = logoFrame(LOGO_COMPLETE_MS, marked, height);
  const pad = " ".repeat(Math.max(0, Math.floor((width - marked) / 2)));
  return frame.rows.map((row, y) => (
    <Box key={`mark${y}`} height={1}>
      <Text color={frame.colour}>{pad + row.cells.map((cell) => (cell.on ? "█" : " ")).join("")}</Text>
    </Box>
  ));
}
