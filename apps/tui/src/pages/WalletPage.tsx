import { Box, Text } from "ink";
import type { Snapshot, TokenHolding } from "@zentis/console-data";
import { tokenAmount } from "../format.js";
import { type Seg, padRows, trunc, wrapLines } from "../layout.js";
import { Segments } from "../components/Segments.js";
import { UI, legColour } from "../theme.js";
import { type Column, columns } from "./table.js";

/**
 * The maker's own side: what this console can sign, and what the wallet holds on each chain.
 *
 * The distinction the page exists for is Aqua's custody model. `ship()` moves no tokens: Aqua
 * records a balance against the strategy and pulls from the wallet at settlement. The committed
 * inventory is therefore *inside* the wallet's balance — held is the truth, committed is a claim on
 * it, free is what is left. A page that showed held and committed as two pots would double the
 * maker's money; one that called the whole balance free would promise inventory already spoken for.
 */
const GAS_DECIMALS = 18;

export function WalletPage({
  snapshot,
  armed,
  width,
  height,
}: {
  snapshot: Snapshot;
  armed: boolean;
  width: number;
  height: number;
}) {
  const rows: React.ReactNode[] = [];
  const wallet = snapshot.wallet;

  // The one place the signing sentence lives, in full, rather than as a word in the status bar.
  rows.push(
    <Segments
      key="signer"
      segs={[
        { text: "signer  ", color: UI.muted },
        armed
          // The variable, never its value: the console does not read the file, and a path on screen
          // is one more thing a screenshot leaks.
          ? { text: "armed — the commands are handed the path in ZENTIS_ENV", color: UI.heading }
          : { text: "watch-only: no ZENTIS_ENV, so nothing here can broadcast", color: UI.caveat },
      ]}
    />,
  );
  if (wallet !== null) {
    rows.push(
      <Segments
        key="maker"
        segs={[
          { text: "maker   ", color: UI.muted },
          { text: wallet.maker, color: UI.heading },
        ]}
      />,
    );
  }
  rows.push(<Text key="sp1"> </Text>);

  if (wallet === null) {
    rows.push(
      <Text key="none" color={UI.caveat}>
        {trunc("the maker's wallet could not be read, so nothing here is known", width)}
      </Text>,
    );
  } else {
    // One row per token per chain: a chain's two tokens have nothing to do with each other beyond
    // sharing a gas balance, and a single row carrying both was unreadable at eighty columns.
    const entries = wallet.chains.flatMap((chain) =>
      [chain.tokenA, chain.tokenB].map((token) => ({ chain, token })),
    );
    const amount = (token: TokenHolding, raw: bigint): Seg[] => [
      { text: tokenAmount(raw, token.decimals), color: UI.heading },
    ];
    const cols: Column[] = [
      {
        header: "chain",
        cells: entries.map(({ chain, token }, i) =>
          // The chain names its first row only: repeating it beside both tokens made the eye read
          // two chains where there is one.
          i % 2 === 0
            ? [{ text: chain.chain.replace(/-sepolia$/, ""), color: legColour(chain.chainId), bold: true }]
            : [{ text: "", color: UI.muted }],
        ),
      },
      { header: "token", cells: entries.map(({ token }) => [{ text: token.symbol, color: UI.heading }]) },
      { header: "held", align: "right", cells: entries.map(({ token }) => amount(token, token.held)) },
      {
        header: "committed",
        align: "right",
        cells: entries.map(({ token }) => amount(token, token.committed)),
      },
      { header: "free", align: "right", cells: entries.map(({ token }) => amount(token, token.free)) },
      {
        header: "allowance",
        align: "right",
        optional: true,
        cells: entries.map(({ token }) => [
          { text: tokenAmount(token.allowance, token.decimals), color: token.allowanceShort ? UI.caveat : UI.muted },
        ]),
      },
      {
        header: "gas",
        align: "right",
        optional: true,
        cells: entries.map(({ chain }, i) =>
          i % 2 === 0 ? [{ text: tokenAmount(chain.gas, GAS_DECIMALS), color: UI.muted }] : [],
        ),
      },
    ];
    const table = columns(cols, width, entries.length);
    rows.push(<Segments key="head" segs={table.header} />);
    for (const [i, segs] of table.rows.entries()) rows.push(<Segments key={`row${i}`} segs={segs} />);
    rows.push(<Text key="sp2"> </Text>);

    // Not a footnote anyone can skip: it is the reason held and committed are not two pots.
    for (const [i, text] of wrapLines(
      "Aqua holds no tokens: it records the committed balance against the shipped strategy and pulls " +
        "from this wallet when a fill settles, so committed is a claim on held rather than a separate " +
        "balance, and free is what a new ship could use.",
      width,
      4,
    ).entries()) {
      rows.push(
        <Text key={`note${i}`} color={UI.muted}>
          {text}
        </Text>,
      );
    }
    for (const [i, caveat] of wallet.caveats.entries()) {
      rows.push(
        <Text key={`cav${i}`} color={UI.caveat}>
          {trunc(`! ${caveat}`, width)}
        </Text>,
      );
    }
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
