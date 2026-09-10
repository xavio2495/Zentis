import { Text } from "ink";
import { UI } from "../theme.js";

/**
 * The frame is 120 columns, a rounded border takes one each side and the padding takes one more, so
 * a rule has 116 to fill. Written down once because a rule that overruns wraps, and a wrapped rule
 * pushes every panel below it down a line — which is how a 40-row layout stops being a 40-row layout.
 */
export const CONTENT_WIDTH = 116;

/**
 * The frame is 120 columns wide and as tall as its content.
 *
 * Not a fixed height: Ink does not clip a box whose content overruns it, it drops the overflow, and
 * a `why` line that wraps to three rows is enough to lose a whole column's heading. The layout is
 * built to come in under 40 rows and is asserted to; pinning the height would hide the day it does
 * not rather than prevent it.
 */
export const FRAME = { width: 120 } as const;

export const Divider = ({ label }: { label: string }) => (
  <Text color={UI.frame}>{`─ ${label} `.padEnd(CONTENT_WIDTH, "─")}</Text>
);
