import { Box, Text } from "ink";
import { type Seg, padRows, trunc, wrapLines } from "../layout.js";
import { Segments } from "../components/Segments.js";
import { spinnerAt } from "../spinner.js";
import { UI } from "../theme.js";

/**
 * The first thing a stranger sees.
 *
 * Three choices, because there are three: make a wallet here, point at one you already have, or
 * watch without either. What the first one will do is said before it does it — where the file goes,
 * what mode it gets, and that the key inside it will not be shown again — because a key written
 * somewhere a reader did not expect is a key they will lose.
 *
 * Nothing here asks what the reader intends to do with the console. The role follows from the
 * address, and the address follows from the key.
 */
export function Onboarding({
  width,
  height,
  running,
  said,
}: {
  width: number;
  height: number;
  /** true while the signing child is making a wallet */
  running: boolean;
  /** what that child said: the address, the path, and the mode */
  said: string | null;
}) {
  const rows: React.ReactNode[] = [];
  const choice = (key: string, title: string, detail: string): void => {
    rows.push(
      <Segments
        key={key}
        segs={[
          { text: `  ${key}  `, color: UI.action, bold: true },
          { text: title, color: UI.heading },
        ] satisfies Seg[]}
      />,
    );
    for (const line of wrapLines(detail, width - 6, 3)) {
      rows.push(
        <Text key={`${key}-${line.slice(0, 8)}`} color={UI.muted}>
          {`     ${line}`}
        </Text>,
      );
    }
    rows.push(<Text key={`${key}-sp`}> </Text>);
  };

  rows.push(
    <Text key="title" color={UI.heading} bold>
      {trunc("this console has no wallet yet", width)}
    </Text>,
  );
  rows.push(<Text key="sp0"> </Text>);

  choice(
    "1",
    "make one here",
    "Writes ~/.zentis/wallet.env, mode 600, and shows you the address. The key stays in that " +
      "file and will not be shown again — not by this screen and not in any log it writes.",
  );
  choice(
    "2",
    "use a key you already have",
    "Give the path to an env file with TAKER_PRIVATE_KEY in it. It is read by the process that " +
      "signs, never by the one drawing this, and the path is remembered so you are not asked again.",
  );
  choice("3", "watch only", "Straight to the live view. Nothing that signs is offered.");

  if (running) {
    rows.push(
      <Text key="working" color={UI.muted}>
        {trunc(`${spinnerAt(Date.now())} making a wallet`, width)}
      </Text>,
    );
  }
  for (const [i, line] of (said ?? "").split("\n").filter((l) => l.trim() !== "").entries()) {
    rows.push(
      <Text key={`said${i}`} color={i === 0 ? UI.fill : UI.muted}>
        {trunc(line, width)}
      </Text>,
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {padRows(rows, height, null).map((row, i) => (
        <Box key={i} height={1}>
          {row ?? <Text> </Text>}
        </Box>
      ))}
    </Box>
  );
}
