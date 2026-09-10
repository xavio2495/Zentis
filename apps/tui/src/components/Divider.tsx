import { Text } from "ink";
import { UI } from "../theme.js";

/**
 * The frame is 120 columns, a rounded border takes one each side and the padding takes one more, so
 * a rule has 116 to fill. Written down once because a rule that overruns wraps, and a wrapped rule
 * pushes every panel below it down a line — which is how a 40-row layout stops being a 40-row layout.
 */
export const CONTENT_WIDTH = 116;

export const Divider = ({ label }: { label: string }) => (
  <Text color={UI.frame}>{`─ ${label} `.padEnd(CONTENT_WIDTH, "─")}</Text>
);
