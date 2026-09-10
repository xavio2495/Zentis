import { Text, useStdout } from "ink";
import { UI } from "../theme.js";

/**
 * The frame's dimensions, taken from the terminal rather than assumed.
 *
 * The layout is designed for 120 columns, but a frame wider than the terminal does not merely look
 * wrong: Ink squeezes every overlong row by deleting characters from inside it, so a 120-column
 * layout in a 100-column terminal silently corrupts numbers. The frame is therefore never wider
 * than the terminal, and the leg columns divide whatever is left.
 */
export const DESIGN_WIDTH = 120;

export function useFrame(): { width: number; contentWidth: number; columnWidth: number } {
  const { stdout } = useStdout();
  const available = stdout?.columns ?? DESIGN_WIDTH;
  // Two for the rounded border, two for the padding.
  const width = Math.max(40, Math.min(DESIGN_WIDTH, available));
  const contentWidth = width - 4;
  return { width, contentWidth, columnWidth: Math.floor(contentWidth / 3) };
}

export const Divider = ({ label, width }: { label: string; width: number }) => (
  <Text color={UI.frame}>{`─ ${label} `.padEnd(width, "─").slice(0, width)}</Text>
);
