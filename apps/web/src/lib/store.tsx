"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { SPEEDS, TICK_MS, type Leg, type Replay, type Step, at, highlightIndex, step, visible } from "./replay";

/**
 * The replay, as React sees it: one integer and a timer.
 *
 * Everything on the screen is derived from the playhead, so there is exactly one piece of state a
 * bug can be in. Speed strides the index rather than changing the interval, which keeps one cadence
 * and one clock however fast the operator wants to move.
 *
 * It plays on load. A judge who does nothing still sees the shift move and the fills land.
 */
interface ReplayState {
  readonly replay: Replay | null;
  readonly playhead: number;
  readonly playing: boolean;
  readonly speed: number;
  readonly length: number;
  /** the leg the detail panels follow; the chart draws all three */
  readonly legIndex: number;
  toggle: () => void;
  reset: () => void;
  scrub: (to: number) => void;
  setSpeed: (stride: number) => void;
  setLegIndex: (index: number) => void;
  /** to the round the seed named, or nothing when the recording does not hold one */
  jumpToHighlight: () => void;
  /** where that round is on the rail, so the marker and the jump cannot disagree */
  readonly highlightAt: number | null;
}

const Ctx = createContext<ReplayState | null>(null);

export function useReplay(): ReplayState {
  const state = useContext(Ctx);
  if (state === null) throw new Error("useReplay outside its provider");
  return state;
}

/** The rounds the playhead runs over: the longest leg, so no leg is cut short. */
const spineOf = (replay: Replay | null): Leg | null =>
  replay === null || replay.legs.length === 0
    ? null
    : replay.legs.reduce((longest, leg) => (leg.rounds.length > longest.rounds.length ? leg : longest));

export function ReplayProvider({ children }: { children: React.ReactNode }) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(SPEEDS[0]!.stride);
  const [legIndex, setLegIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let live = true;
    // Through the route rather than imported: the seed is static today and a live read later is one
    // file, and the boundary is the whole point of the route existing.
    void fetch("/api/replay")
      .then((answer) => answer.json() as Promise<Replay>)
      .then((value) => {
        if (live) setReplay(value);
      })
      .catch(() => {
        if (live) setReplay(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const spine = spineOf(replay);
  const length = spine?.rounds.length ?? 0;
  // Against the spine, which is the leg the playhead runs over: the marker on the rail and the jump
  // have to be the same index or the chip lands somewhere the marker is not.
  const highlightAt = highlightIndex(spine?.rounds ?? [], replay?.highlight);

  useEffect(() => {
    if (!playing || length === 0) return undefined;
    timer.current = setInterval(() => {
      setPlayhead((current) => (current + speed >= length ? length - 1 : current + speed));
    }, TICK_MS);
    return () => {
      if (timer.current !== null) clearInterval(timer.current);
    };
  }, [playing, speed, length]);

  /**
   * The keys a reader tries first.
   *
   * Space, the arrows, home and end — on the window rather than on the transport, because the
   * transport is a strip at the bottom of the screen and nobody clicks into it before pressing
   * space. A field keeps its own keys: the scrub handle is an input, and space on it would both
   * drag the handle and toggle play.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable === true) {
        // The one exception: space on the scrub handle should still play and pause, because the
        // handle is where a reader's hand already is. The arrows there are the handle's own.
        if (!(tag === "INPUT" && event.key === " ")) return;
      }
      const keys: Record<string, Step> = { ArrowLeft: "left", ArrowRight: "right", Home: "home", End: "end" };
      const which = keys[event.key];
      if (which !== undefined) {
        event.preventDefault();
        // Stepping is reading rather than watching, so it pauses, exactly as dragging does.
        setPlaying(false);
        setPlayhead((current) => step(current, which, event.shiftKey, length));
        return;
      }
      if (event.key === " " || event.key === "Spacebar") {
        // Or the page scrolls under the screen it is meant to be controlling.
        event.preventDefault();
        setPlaying((current) => {
          if (!current && length > 0) setPlayhead((at) => (at >= length - 1 ? 0 : at));
          return !current;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [length]);

  // At the end it stops rather than looping: a replay that restarts under a reader who is reading
  // the last frame takes the answer away from them.
  useEffect(() => {
    if (length > 0 && playhead >= length - 1) setPlaying(false);
  }, [playhead, length]);

  const value = useMemo<ReplayState>(
    () => ({
      replay,
      playhead,
      playing,
      speed,
      length,
      legIndex,
      toggle: () =>
        setPlaying((current) => {
          if (!current && length > 0 && playhead >= length - 1) setPlayhead(0);
          return !current;
        }),
      reset: () => {
        setPlayhead(0);
        setPlaying(true);
      },
      // Scrubbing pauses, always: a reader dragging the handle is reading, not watching.
      scrub: (to: number) => {
        setPlaying(false);
        setPlayhead(Math.max(0, Math.min(length - 1, Math.round(to))));
      },
      setSpeed,
      setLegIndex,
      highlightAt,
      jumpToHighlight: () => {
        if (highlightAt === null) return;
        setPlaying(false);
        // A couple of rounds before it, so the reader arrives just ahead of the thing they came to
        // see rather than on top of it with no idea what it moved from.
        setPlayhead(Math.max(0, Math.min(length - 1, highlightAt - 2)));
      },
    }),
    [replay, playhead, playing, speed, length, legIndex, highlightAt],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** What a leg looks like at the playhead, which is all any panel needs of it. */
export function useLegAt(leg: Leg | null) {
  const { playhead } = useReplay();
  return useMemo(() => {
    if (leg === null) return null;
    const shown = visible(leg.rounds, playhead);
    const now = at(leg.rounds, playhead);
    const until = now?.atSeconds ?? 0;
    // The recording keeps the last twenty-five published rounds — about two hours — while the fills
    // go back days. A fill older than the first round did not happen "at the left edge of the
    // chart": it happened before the window, and saying so is the difference between a timeline and
    // a pile of markers stacked on zero.
    const from = leg.rounds[0]?.atSeconds ?? 0;
    const taken = leg.fills.filter((fill) => fill.atSeconds <= until);
    return {
      shown,
      now,
      fills: taken,
      inWindow: taken.filter((fill) => fill.atSeconds >= from),
      earlier: taken.filter((fill) => fill.atSeconds < from),
      windowFromSeconds: from,
      rejections: leg.rejections.filter(
        (rejection) => rejection.atSeconds <= until && rejection.atSeconds >= from,
      ),
    };
  }, [leg, playhead]);
}

export const useSpeeds = () => SPEEDS;
