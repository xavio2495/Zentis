"use client";

import { useEffect, useState } from "react";
import { bandState } from "@/lib/replay";
import { ago, midAsPrice, signedBps, tokenAmount } from "@/lib/format";
import { useLegAt, useReplay } from "@/lib/store";
import { ShiftPanel } from "./ShiftPanel";
import { SimPanel, type SimSeed } from "./SimPanel";
import { BookRow } from "./BookRow";
import { FeedPanel } from "./FeedPanel";
import { LegCard } from "./LegCard";
import { PnlPanel } from "./PnlPanel";
import { MarketPanel } from "./MarketPanel";
import { MarkGlyph } from "./MarkGlyph";
import { Transport } from "./Transport";
import { Chip, Stat, VRule } from "./ui";

/**
 * One screen, four bands, nothing that scrolls.
 *
 * A judge has about forty seconds. What they should be able to do in that time is press play, watch
 * the shift move against the band, and see a real fill land — so the screen is fixed, the replay
 * auto-plays, and every panel says where its numbers came from.
 */
export function Screen() {
  const { replay, legIndex, setLegIndex } = useReplay();
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
      {/*
        Three groups, and the middle one genuinely in the middle.

        `justify-between` puts a middle group wherever the outer two leave it, which drifts every
        time the identity or the sponsor chips change width. A grid whose outer tracks are equal
        pins the leg switcher to the centre of the bar and keeps it there.
      */}
      <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-stroke px-4">
        <div className="flex min-w-0 items-center gap-3">
          {/* The way back. A route reached from the landing that cannot return to it is a dead end
              costing a browser button, and the mark is where a reader looks for home. */}
          <a href="/" className="tap flex items-center gap-3 no-underline" aria-label="Zentis — back to the landing page">
            <MarkGlyph className="fill-em" />
            <span className="label whitespace-nowrap text-ink">Zentis</span>
          </a>
          <span aria-hidden className="h-4 w-px bg-stroke" />
          <a href="/console" className="label-sm tap whitespace-nowrap text-ink-faint no-underline hover:text-ink">
            Console
          </a>
          {/* A rule on both sides of the link, or "Console" and the subtitle run together and read
              as one phrase: "console replay · recorded testnet reads". */}
          <span aria-hidden className="hidden h-4 w-px bg-stroke xl:block" />
          {/* Dropped rather than wrapped: three lines of subtitle push the bar out of its own
              height, and the words are the least load-bearing thing on the screen. */}
          <span className="label-sm hidden truncate text-ink-faint xl:inline">recorded testnet reads</span>
        </div>
        <div className="flex items-center justify-center gap-2">
          {(replay?.legs ?? []).map((option, index) => (
            <Chip key={option.chainId} active={index === legIndex} onClick={() => setLegIndex(index)}>
              {option.label}
            </Chip>
          ))}
        </div>
        {/* At every width, wrapping rather than disappearing: these three are what the project is
            judged on, and `hidden md:flex` took them off the page entirely on a phone. */}
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {["1inch · Aqua", "The Graph · subgraphs", "Chainlink · CRE"].map((chip) => (
            <span key={chip} className="label-sm whitespace-nowrap border border-stroke px-2 py-1 text-ink-faint">
              {chip}
            </span>
          ))}
        </div>
      </header>

      {/*
        The playhead's own row, which moves as the replay runs.

        Dividers are drawn between the stats rather than with `divide-x`, which borders every child
        but the first — including the spacer, leaving a rule floating in the empty middle. The bar
        has a floor rather than a fixed height: a two-line stat in a fixed 36px clips its own value
        at narrow widths, and the unit is the first thing to go.
      */}
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-stroke bg-inset px-4 py-1">
        <Stat label="shift" value={now === null ? "—" : `${signedBps(now.tiltBps)} bps`} tone="signal" />
        <VRule />
        <Stat label="band" value={band ?? "—"} tone={band === "clamped" ? "bad" : band === "near edge" ? "warn" : "soft"} />
        <VRule />
        <Stat label="cap" value={leg === null ? "—" : `±${leg.maxTiltBps} bps`} tone="faint" />
        <VRule />
        {/* Not "seq": the book row below carries the recorded moment's seq, and two different
            numbers under one label on touching rows reads as one number that moved. */}
        <Stat label="round" value={now === null ? "—" : String(now.seq)} tone="soft" />
        <VRule />
        <Stat label="mid" value={now === null ? "—" : `${midAsPrice(now.mid)} USDC/WETH`} tone="soft" />
        <div className="flex-1" />
        <Stat label="fills" value={String(fills.length)} tone="ink" />
        <VRule />
        <Stat label="taken" value={`${tokenAmount(String(volume), 6)} USDC`} tone="soft" />
        <VRule />
        <Stat
          label="recorded"
          value={replay === null ? "—" : `${ago(now?.atSeconds ?? 0, replay.provenance.recordedAtSeconds)} before the read`}
          tone="faint"
        />
      </div>

      <BookRow book={replay?.book} providers={replay?.providers ?? []} />

      {/*
        One screen, and nothing outside a panel scrolls.
        
        Below xl the page gives up and scrolls, because thirteen panels do not fit on a phone and a
        screen that hides half its evidence is worse than one that is long. At xl — the judge's
        laptop — the grid is screen height, every panel owns its own overflow, and the discipline
        the reference established holds.
      */}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-12 xl:grid-rows-[minmax(0,1.05fr)_minmax(0,1.15fr)_minmax(0,0.8fr)] xl:overflow-hidden">
        <div className="flex min-h-0 flex-col gap-2 xl:col-span-5 xl:row-span-1">
          <MarketPanel legs={replay?.legs ?? []} market={replay?.market} playedTo={now?.atSeconds ?? null} />
        </div>
        <div className="flex min-h-0 flex-col gap-2 xl:col-span-4">
          <ShiftPanel leg={leg} />
        </div>
        <div className="flex min-h-0 flex-col gap-2 xl:col-span-3">
          <FeedPanel legs={replay?.legs ?? []} untilSeconds={now?.atSeconds ?? null} />
        </div>

        {/* The three legs across: one position, said three times. */}
        {/* A row to themselves: three cards four columns wide, because at three columns the
            holds, the quote and the decomposition collide. */}
        {(replay?.legs ?? []).map((each) => (
          <div key={each.chainId} className="flex min-h-0 flex-col xl:col-span-4">
            <LegCard leg={each} />
          </div>
        ))}

        <div className="flex min-h-0 flex-col gap-2 xl:col-span-8">
          <PnlPanel legs={replay?.legs ?? []} book={replay?.book} />
        </div>
        <div className="flex min-h-0 flex-col gap-2 xl:col-span-4">
          <SimPanel sim={sim} />
        </div>
      </main>

      <Transport />
    </div>
  );
}
