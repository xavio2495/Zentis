import { Box, Text } from "ink";
import { markRows } from "../components/Logo.js";
import { FAUCETS, QUOTE_SIZE_A, type Snapshot, type TokenHolding } from "@zentis/console-data";
import { tokenAmount } from "../format.js";
import { type Seg, fitSegments, padRows, trunc, wrapLines } from "../layout.js";
import { Segments } from "../components/Segments.js";
import { UI, legColour } from "../theme.js";
import { spinnerAt } from "../spinner.js";
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

    // How Aqua's custody works — why committed is a claim on held rather than a second pot — is in
    // help under this page's heading. The page itself is the balances.
    // A chain with no gas cannot do anything at all, so the page says where to get some — and stops
    // saying it the moment the balance arrives, because this page already polls and a funded chain
    // being offered a faucet reads as a screen that has not noticed.
    const empty = wallet.chains.filter((chain) => chain.gas === 0n);
    if (empty.length > 0) {
      rows.push(<Text key="fundsp"> </Text>);
      rows.push(
        <Text key="fundhead" color={UI.heading} bold>
          {trunc(`${spinnerAt(Date.now())} waiting for gas on ${empty.length} chain${empty.length === 1 ? "" : "s"}`, width)}
        </Text>,
      );
      rows.push(
        <Segments
          key="fundaddr"
          segs={[
            { text: "send it to  ", color: UI.muted },
            { text: wallet.maker, color: UI.heading },
          ]}
        />,
      );
      for (const chain of empty) {
        const leg = snapshot.legs.find((l) => l.config.chainId === chain.chainId);
        // The leg's own short name, not the wallet's recorded label: "Arbitrum Sepolia" is wider
        // than the column and pushed its row out of line with the others.
        const name = (leg?.config.name ?? chain.chain).replace(/-sepolia$/i, "").trim();
        // Keyed by the leg's own name, not by whatever the wallet recorded as a label: the recorded
        // wallet carries "Arbitrum Sepolia" where the faucet list is keyed "arbitrum-sepolia".
        for (const [i, faucet] of (FAUCETS[leg?.config.name ?? ""] ?? []).entries()) {
          rows.push(
            <Segments
              key={`faucet-${chain.chainId}-${i}`}
              segs={fitSegments(
                [
                  [
                    { text: `${(i === 0 ? name : "").padEnd(10)}  `, color: legColour(chain.chainId) },
                    { text: faucet, color: UI.action },
                  ],
                  [{ text: faucet, color: UI.action }],
                ],
                width,
              )}
            />,
          );
        }
        if (leg !== undefined) {
          // The token addresses, because a faucet gives gas and a wallet has to be told what else to
          // show. Both are public and both are needed before a fill can be taken.
          rows.push(
            <Segments
              key={`tokens-${chain.chainId}`}
              segs={fitSegments(
                [
                  [
                    { text: "".padEnd(12), color: UI.muted },
                    { text: `${leg.config.tokenA.symbol} ${leg.config.tokenA.address}  `, color: UI.muted },
                    { text: `${leg.config.tokenB.symbol} ${leg.config.tokenB.address}`, color: UI.muted },
                  ],
                  [
                    { text: "".padEnd(12), color: UI.muted },
                    { text: `${leg.config.tokenA.symbol} ${leg.config.tokenA.address}`, color: UI.muted },
                  ],
                ],
                width,
              )}
            />,
          );
        }
      }
    }

    // Where the allowance column already shows a shortfall, the one thing to do about it.
    const short = wallet.chains.filter((chain) => chain.tokenA.allowance < QUOTE_SIZE_A || chain.tokenA.allowanceShort);
    if (short.length > 0) {
      rows.push(<Text key="appsp"> </Text>);
      rows.push(
        <Text key="apphead" color={UI.heading} bold>
          {trunc("approve, so a fill can settle", width)}
        </Text>,
      );
      for (const chain of short) {
        const leg = snapshot.legs.find((l) => l.config.chainId === chain.chainId);
        const name = (leg?.config.name ?? chain.chain).replace(/-sepolia$/i, "").trim();
        rows.push(
          <Segments
            key={`approve-${chain.chainId}`}
            segs={fitSegments(
              [
                [
                  { text: `${name.padEnd(10)}  `, color: legColour(chain.chainId) },
                  { text: `: approve ${name}`, color: UI.action },
                  { text: `  (it asks before it broadcasts)`, color: UI.muted },
                ],
                [
                  { text: `${name.padEnd(10)}  `, color: legColour(chain.chainId) },
                  { text: `: approve ${name}`, color: UI.action },
                ],
              ],
              width,
            )}
          />,
        );
      }
    }

    for (const [i, caveat] of wallet.caveats.entries()) {
      for (const [j, text] of wrapLines(caveat, width - 2, 3).entries()) {
        rows.push(
          <Text key={`cav${i}-${j}`} color={UI.caveat}>
            {j === 0 ? `! ${text}` : `  ${text}`}
          </Text>,
        );
      }
    }
  }

  // Whatever the table did not need goes to the mark. It is the one thing on these pages that can be
  // given room rather than take it: nothing is drawn unless the rows were already spare.
  rows.push(...markRows(width, height - rows.length));

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
