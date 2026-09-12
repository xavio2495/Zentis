"use client";

import { SPEEDS } from "@/lib/replay";
import { clock } from "@/lib/format";
import { useReplay } from "@/lib/store";
import { Chip } from "./ui";

/**
 * The transport, and the marker that says where the interesting round is.
 *
 * The jump is the part worth having: a judge with thirty seconds should not have to drag a handle
 * looking for the moment the shift hit its cap. The marker on the rail says where that moment is
 * before you get there.
 */
export function Transport() {
  const { replay, playhead, playing, speed, length, legIndex, toggle, reset, scrub, setSpeed, jumpToHighlight, highlightAt } =
    useReplay();
  const leg = replay?.legs[legIndex] ?? null;
  const highlight = replay?.highlight ?? null;
  const now = leg?.rounds[Math.min(playhead, leg.rounds.length - 1)] ?? null;
  // What the chip calls the round it goes to. The seed decides which round deserves the jump and
  // writes the sentence; this only chooses three words for the face of the button.
  const jumpLabel =
    highlight?.kind === "reference-change"
      ? "⤒ reference change"
      : highlight?.kind === "capped"
        ? "⤒ on the cap"
        : "⤒ widest lean";

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-t border-stroke bg-inset px-3">
      <Chip onClick={toggle} title="play or pause">
        {playing ? "❚❚ pause" : "▶ play"}
      </Chip>
      <Chip onClick={reset} title="back to the first round">
        ↺ reset
      </Chip>
      <Chip
        onClick={jumpToHighlight}
        disabled={highlightAt === null}
        title={highlight === null ? "this recording has no round worth jumping to" : highlight.why}
      >
        {jumpLabel}
      </Chip>

      <div className="flex items-center gap-1">
        {SPEEDS.map((option) => (
          <Chip key={option.label} active={speed === option.stride} onClick={() => setSpeed(option.stride)}>
            {option.label}
          </Chip>
        ))}
      </div>

      <div className="relative min-w-0 flex-1">
        <input
          type="range"
          className="cb-range"
          min={0}
          max={Math.max(0, length - 1)}
          value={playhead}
          onChange={(event) => scrub(Number(event.target.value))}
          aria-label="scrub the replay"
        />
        {highlightAt !== null && length > 1 && (
          <span
            /* Brightness, not the accent: the accent on this screen means "this is what Zentis
               computed", and a marker saying where to look is navigation rather than a number. It
               was `bg-bad` before, which claimed the round was a fault; most of the time it is
               simply the most interesting one. */
            className="pointer-events-none absolute top-0 h-full w-px bg-ink-soft"
            style={{ left: `${(highlightAt / (length - 1)) * 100}%` }}
            title={highlight?.why}
          />
        )}
      </div>

      {/* The keys are on the strip that answers them, at the width that has room for them: a
          control nobody knows about is a control nobody uses. */}
      <span className="label-sm hidden shrink-0 whitespace-nowrap text-ink-faint xl:inline">
        space · ← → · shift ×10 · home/end
      </span>
      <span className="tnum shrink-0 font-mono text-[11px] text-ink-faint">
        {now === null ? "—" : `${clock(now.atSeconds)} UTC · ${playhead + 1}/${length}`}
      </span>
    </div>
  );
}
