"use client";

import { useEffect, useState } from "react";
import { bandState } from "@/lib/replay";
import { ago, midAsPrice, signedBps, tokenAmount } from "@/lib/format";
import { useLegAt, useReplay } from "@/lib/store";
import { FillsPanel } from "./FillsPanel";
import { ShiftPanel } from "./ShiftPanel";
import { SimPanel, type SimSeed } from "./SimPanel";
import { BookRow } from "./BookRow";
import { FeedPanel } from "./FeedPanel";
import { LegCard } from "./LegCard";
import { PnlPanel } from "./PnlPanel";
import { MarketPanel } from "./MarketPanel";
import { MarkGlyph } from "./MarkGlyph";
import { Transport } from "./Transport";
import { Chip, Panel, Stat } from "./ui";

/**
 * One screen, four bands, nothing that scrolls.
 *
 * A judge has about forty seconds. What they should be able to do in that time is press play, watch
 * the shift move against the band, and see a real fill land — so the screen is fixed, the replay
 * auto-plays, and every panel says where its numbers came from.
 */
export function Screen() {
  const { replay, legIndex, setLegIndex, playhead } = useReplay();
  const leg = replay?.legs[legIndex] ?? null;
  const state = useLegAt(leg);
  const [sim, setSim] = useState<SimSeed | null>(null);

  useEffect(() => {
    void fetch("/api/sim")
      .then((answer) => answer.json() as Promise<SimSeed>)
      .then(setSim)
      .catch(() => setSim(null));
  }, []);

  const now = state?.now ?? null;
  const band = now === null || leg === null ? null : bandState(now.tiltBps, leg.maxTiltBps);
  const fills = state?.fills ?? [];
  const volume = fills.filter((fill) => fill.isAToB).reduce((sum, fill) => sum + BigInt(fill.amountIn), BigInt(0));

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-stroke px-4">
        <div className="flex items-center gap-3">
          <MarkGlyph className="text-ink" />
          <span className="label text-ink">Zentis</span>
          <span className="label-sm text-ink-faint">replay · recorded testnet reads</span>
        </div>
        <div className="flex items-center gap-2">
          {(replay?.legs ?? []).map((option, index) => (
            <Chip key={option.chainId} active={index === legIndex} onClick={() => setLegIndex(index)}>
              {option.label}
            </Chip>
          ))}
        </div>
        <div className="hidden items-center gap-2 md:flex">
          {["1inch · Aqua", "The Graph · subgraphs", "Chainlink · CRE"].map((chip) => (
            <span key={chip} className="label-sm border border-stroke px-2 py-1 text-ink-faint">
              {chip}
            </span>
          ))}
        </div>
      </header>

      <div className="flex h-9 shrink-0 items-center gap-6 divide-x divide-stroke border-b border-stroke bg-inset px-4">
        <Stat label="shift" value={now === null ? "—" : `${signedBps(now.tiltBps)} bps`} tone="signal" />
        <Stat label="band" value={band ?? "—"} tone={band === "clamped" ? "bad" : band === "near edge" ? "warn" : "soft"} />
        <Stat label="cap" value={leg === null ? "—" : `±${leg.maxTiltBps} bps`} tone="faint" />
        <Stat label="seq" value={now === null ? "—" : String(now.seq)} tone="soft" />
        <Stat label="mid" value={now === null ? "—" : `${midAsPrice(now.mid)} USDC/WETH`} tone="soft" />
        <div className="flex-1" />
        <Stat label="fills" value={String(fills.length)} tone="ink" />
        <Stat label="taken" value={`${tokenAmount(String(volume), 6)} USDC`} tone="soft" />
        <Stat
          label="recorded"
          value={replay === null ? "—" : `${ago(now?.atSeconds ?? 0, replay.provenance.recordedAtSeconds)} before the read`}
          tone="faint"
        />
      </div>

      <BookRow book={replay?.book} providers={replay?.providers ?? []} />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-12">
        <div className="grid min-h-0 grid-rows-[0.9fr_1fr_0.9fr] gap-2 xl:col-span-8">
          <MarketPanel legs={replay?.legs ?? []} market={replay?.market} playedTo={now?.atSeconds ?? null} />
          <ShiftPanel leg={leg} />
          <FillsPanel leg={leg} />
        </div>
        <div className="flex min-h-0 flex-col gap-2 xl:col-span-4">
          <Panel title="the position" tag={leg === null ? "waiting" : "deployment record"} className="flex-1">
            {leg === null ? (
              <p className="m-0 text-fs-0 text-ink-faint">waiting</p>
            ) : (
              <div className="flex flex-col gap-3">
                <Stat label="strategy hash" value={`${leg.strategyHash.slice(0, 10)}…${leg.strategyHash.slice(-4)}`} tone="soft" />
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="committed A" value={`${tokenAmount(leg.balanceA, 6)} USDC`} />
                  <Stat label="committed B" value={`${tokenAmount(leg.balanceB, 18)} WETH`} />
                </div>
                <Stat label="rounds played" value={`${Math.min(playhead + 1, leg.rounds.length)}/${leg.rounds.length}`} tone="faint" />
                <p className="m-0 text-[10px] text-ink-faint">
                  One position, three chains. The shift is the only thing that moves between them — nothing bridges.
                </p>
              </div>
            )}
          </Panel>
          <SimPanel sim={sim} />
        </div>
      </main>

      <section className="grid shrink-0 grid-cols-1 gap-2 px-2 pb-2 lg:grid-cols-2">
        <FeedPanel legs={replay?.legs ?? []} untilSeconds={now?.atSeconds ?? null} />
        <PnlPanel legs={replay?.legs ?? []} book={replay?.book} />
      </section>

      {/* The three legs across, below the charts: one position, said three times. */}
      <section className="grid shrink-0 grid-cols-1 gap-2 px-2 pb-2 lg:grid-cols-3">
        {(replay?.legs ?? []).map((each) => (
          <LegCard key={each.chainId} leg={each} />
        ))}
      </section>

      <Transport />
    </div>
  );
}
