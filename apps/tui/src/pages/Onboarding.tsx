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
 * The rows the choices need: a title, a blank, three rows of buttons, and the words for whichever
 * one is under the cursor. The mark above gets whatever is left, and nothing when that is too
 * little — a choice a reader cannot see is not offered, and the mark is the part that can be spared.
 */
export const ONBOARDING_ROWS = 14;

/** The three, in the order they are shown and in the order the numbers have always meant. */
export const CHOICES = [
  {
    key: "1",
    face: "make a wallet",
    title: "make one here",
    detail:
      "Writes ~/.zentis/wallet.env, mode 600, and shows you the address. The key stays in that " +
      "file and will not be shown again — not by this screen and not in any log it writes.",
  },
  {
    key: "2",
    face: "use my own key",
    title: "use a key you already have",
    detail:
      "Give the path to an env file with TAKER_PRIVATE_KEY in it. It is read by the process that " +
      "signs, never by the one drawing this, and the path is remembered so you are not asked again.",
  },
  {
    key: "3",
    face: "watch only",
    title: "watch only",
    detail: "Straight to the live view. Nothing that signs is offered.",
  },
] as const;

/**
 * Where the cursor goes next.
 *
 * It stops at both ends rather than wrapping. Three is a row a reader takes in whole, and a cursor
 * that reappears at the far end reads as a keystroke that did something other than move.
 */
export function choiceAt(current: number, direction: "left" | "right"): number {
  const moved = current + (direction === "right" ? 1 : -1);
  return Math.max(0, Math.min(CHOICES.length - 1, moved));
}

/**
 * Three buttons on three rows: the tops, the faces, the bottoms.
 *
 * Drawn as segments rather than as Ink boxes for the reason every row here is: an overlong row makes
 * Ink delete characters inside it, and a border built out of nested boxes is the row most likely to
 * be one cell too wide. The one under the cursor is the only thing on the page wearing the accent,
 * which is what makes it read as chosen rather than merely first.
 */
const GAP = 2;

function buttons(width: number, focus: number): Seg[][] {
  const each = Math.max(6, Math.floor((width - GAP * (CHOICES.length - 1)) / CHOICES.length));
  const inner = each - 2;
  const rows: Seg[][] = [[], [], []];
  for (const [i, choice] of CHOICES.entries()) {
    const colour = i === focus ? UI.signal : UI.frame;
    const face = trunc(`${choice.key}  ${choice.face}`, inner);
    const pad = inner - face.length;
    const before = Math.max(0, Math.floor(pad / 2));
    if (i > 0) for (const row of rows) row.push({ text: " ".repeat(GAP) });
    rows[0]!.push({ text: `┌${"─".repeat(inner)}┐`, color: colour });
    rows[1]!.push(
      { text: "│", color: colour },
      { text: " ".repeat(before) },
      { text: face, color: i === focus ? UI.heading : UI.muted, bold: i === focus },
      { text: " ".repeat(Math.max(0, pad - before)) },
      { text: "│", color: colour },
    );
    rows[2]!.push({ text: `└${"─".repeat(inner)}┘`, color: colour });
  }
  return rows;
}

export function Onboarding({
  width,
  height,
  running,
  said,
  focus = 0,
  asking = null,
  problem = null,
}: {
  width: number;
  height: number;
  /** which of the three the cursor is on; its words are the ones shown underneath */
  focus?: number;
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
  } else if (said === null) {
    const chosen = CHOICES[Math.max(0, Math.min(CHOICES.length - 1, focus))]!;
    for (const [i, row] of buttons(width, focus).entries()) {
      rows.push(<Segments key={`button-row-${i}`} segs={row} />);
    }
    rows.push(<Text key="sp-tip"> </Text>);
    // The words belong to the button under the cursor, and only to it. Three blocks of reasoning on
    // screen at once is a reader comparing paragraphs; one at a time is a reader considering an
    // option — and it is the same page either way, minus the wall.
    rows.push(
      <Text key="tip-title" color={UI.heading} bold>
        {trunc(chosen.title, width)}
      </Text>,
    );
    for (const [i, line] of wrapLines(chosen.detail, width, 3).entries()) {
      rows.push(
        <Text key={`tip-${i}`} color={UI.muted}>
          {line}
        </Text>,
      );
    }
    rows.push(<Text key="sp-keys"> </Text>);
    rows.push(
      <Text key="keys" color={UI.action}>
        {trunc("← → to choose · enter to take it · 1 2 3 · x to quit", width)}
      </Text>,
    );
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
