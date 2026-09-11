import { Box, Text } from "ink";
import { type Seg, fitSegments, trunc } from "../layout.js";
import { Segments } from "./Segments.js";
import { UI } from "../theme.js";

/**
 * The row the operator types on, and the row the answer comes back on — the same row.
 *
 * An answer somewhere else on the screen is an answer a reader has to go and find. What was asked
 * stays visible beside what came back, so a refused command reads as a correction to the line that
 * caused it rather than as a new event.
 *
 * There is no cursor character while a command is running: the row is not accepting keys then, and
 * a blinking prompt that ignores the keyboard is a lie about who has it.
 */
export function CommandLine({
  text,
  answer,
  running,
  width,
}: {
  text: string;
  /** what the last command said, or null while one is being typed */
  answer: { text: string; bad: boolean } | null;
  running: boolean;
  width: number;
}) {
  const typed: Seg[] = [
    { text: ":", color: UI.action, bold: true },
    { text, color: UI.heading },
    ...(running ? [] : [{ text: "▏", color: UI.action }]),
  ];
  const room = Math.max(0, width - typed.reduce((n, seg) => n + seg.text.length, 0) - 2);
  const reply = (text: string): Seg[] =>
    answer === null ? [] : [{ text: `  ${text}`, color: answer.bad ? UI.caveat : UI.muted }];

  return (
    <Box width={width} height={1} overflow="hidden">
      {/* Measured, like every other row: the answer gives way to what was typed, never the reverse —
          a command half-shown cannot be corrected by the operator reading it. */}
      {/* The answer is prose and may be cut; what was typed never is. An answer too long for the row
          is better half-read than absent, but a command half-shown cannot be corrected. */}
      <Segments
        segs={fitSegments([[...typed, ...reply(answer?.text ?? "")], [...typed, ...reply(trunc(answer?.text ?? "", room))], typed], width)}
      />
    </Box>
  );
}
