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
/**
 * The rows the choices need: a title, a blank, and three choices of a heading and up to three
 * wrapped lines each. The mark above gets whatever is left, and nothing when that is too little —
 * a choice a reader cannot see is not offered, and the mark is the part that can be spared.
 */
export const ONBOARDING_ROWS = 17;

export function Onboarding({
  width,
  height,
  running,
  said,
  asking = null,
  problem = null,
}: {
  width: number;
  height: number;
  /** true while the signing child is making a wallet */
  running: boolean;
  /** what that child said: the address, the path, and the mode */
  said: string | null;
  /** the path being typed, once the second choice has been taken; null while still choosing */
  asking?: string | null;
  /** why the last path did not work, kept on screen with the field still open */
  problem?: string | null;
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

  // The second choice asks for its path here rather than borrowing the live view's command row. That
  // row belongs to a console that is already running, at the bottom of a screen a reader who has not
  // chosen yet has never been shown; the question belongs where it was offered.
  if (asking !== null) {
    rows.push(
      <Segments
        key="asking"
        segs={[
          { text: "  2  ", color: UI.action, bold: true },
          { text: "use a key you already have", color: UI.heading },
        ] satisfies Seg[]}
      />,
    );
    const detail =
      "The path to an env file with TAKER_PRIVATE_KEY in it. It is read by the process that signs, " +
      "never by the one drawing this, and the path is remembered so you are not asked again.";
    for (const line of wrapLines(detail, width - 6, 3)) {
      rows.push(
        <Text key={`ask-${line.slice(0, 8)}`} color={UI.muted}>
          {`     ${line}`}
        </Text>,
      );
    }
    rows.push(<Text key="ask-sp"> </Text>);
    // Kept to its end when it is long: the tail is the part being typed, and the part that says
    // which file this is.
    const room = Math.max(1, width - 12);
    const shown = asking.length > room ? `…${asking.slice(-(room - 1))}` : asking;
    rows.push(
      <Segments
        key="field"
        segs={[
          { text: "     path  ", color: UI.muted },
          { text: shown, color: UI.fill },
          { text: "▏", color: UI.action },
        ] satisfies Seg[]}
      />,
    );
    rows.push(<Text key="ask-sp2"> </Text>);
    if (problem !== null) {
      for (const [i, line] of wrapLines(problem, width, 2).entries()) {
        rows.push(
          <Text key={`problem${i}`} color={UI.caveat}>
            {line}
          </Text>,
        );
      }
    }
    if (said === null) {
      rows.push(
        <Text key="ask-keys" color={UI.action}>
          {trunc("enter to use it · esc to go back", width)}
        </Text>,
      );
    }
  } else {
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
  }

  if (running) {
    rows.push(
      <Text key="working" color={UI.muted}>
        {trunc(`${spinnerAt(Date.now())} making a wallet`, width)}
      </Text>,
    );
  }

  if (said !== null && said.trim() !== "") {
    // The address first and whole. It is the one thing on this page a reader has to copy — into a
    // faucet, into a wallet — and an address with an ellipsis in it is not an address. Everything
    // else the child said follows it, wrapped.
    const address = /0x[0-9a-fA-F]{40}/.exec(said)?.[0] ?? null;
    // The label goes with the value it labelled: the child says "address 0x…", and leaving the word
    // behind put "address · written …" on the line under the address it had just been taken out of.
    const rest = (address === null ? said : said.split(address).join(""))
      .replace(/\baddress\b/g, "")
      .replace(/\s+·\s+/g, " · ")
      .trim();
    if (address !== null) {
      rows.push(
        <Segments
          key="address"
          segs={[
            { text: "address  ", color: UI.muted },
            { text: address, color: UI.fill, bold: true },
          ] satisfies Seg[]}
        />,
      );
    }
    for (const [i, line] of wrapLines(rest.replace(/^[·\s]+/, ""), width, 3).entries()) {
      rows.push(
        <Text key={`said${i}`} color={UI.muted}>
          {line}
        </Text>,
      );
    }
    rows.push(<Text key="sp-forward"> </Text>);
    rows.push(
      <Text key="forward" color={UI.action}>
        {trunc("enter to continue with this wallet", width)}
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
