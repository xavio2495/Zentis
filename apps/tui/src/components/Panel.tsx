import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { trunc } from "../layout.js";
import { UI } from "../theme.js";

/**
 * A bordered region of exact size, with its title written into the top edge.
 *
 * Ink has no box title, and these titles carry state — `1 Sepolia · live`, `market price · Base` —
 * so the top edge is drawn by hand as one line and the box below it carries only its left, right and
 * bottom edges. The cost is exactly two rows, which is what the layout budget assumes.
 *
 * The child is given one region of exactly `width - 2` by `height - 2` and manages its own rows
 * inside it. An earlier version wrapped each child in a one-row box, which quietly clipped any
 * component that drew more than one line — the status bar lost the `r` from its key hints that way,
 * and looked like a squeezed row rather than a clipped component.
 */
export function Panel({
  title,
  right,
  width,
  height,
  colour = UI.frame,
  children,
}: {
  title: string;
  right?: string;
  width: number;
  height: number;
  colour?: string;
  children: ReactNode;
}) {
  // The border is drawn to fit, never truncated. Cutting the line at `width` removes the closing
  // corner and the frame reads as broken; the right-hand label is the part that can be spared, so
  // it is dropped whole when there is no room for it.
  const left = trunc(` ${title} `, Math.max(0, width - 2));
  const tail = right === undefined || right === "" ? "" : ` ${right} `;
  const room = width - 2 - left.length;
  const shown = tail.length + 1 <= room ? tail : "";
  const fill = Math.max(0, room - shown.length);
  const top = `┌${left}${"─".repeat(fill)}${shown}┐`;

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Text color={colour}>{top}</Text>
      <Box
        width={width}
        height={height - 1}
        borderStyle="round"
        borderTop={false}
        borderColor={colour}
        overflow="hidden"
      >
        <Box flexDirection="column" width={width - 2} height={height - 2} overflow="hidden">
          {children}
        </Box>
      </Box>
    </Box>
  );
}

/** What a child of `Panel` gets to draw in. Written down so call sites cannot disagree with it. */
export const panelInner = (width: number, height: number) => ({
  width: width - 2,
  height: height - 2,
});
