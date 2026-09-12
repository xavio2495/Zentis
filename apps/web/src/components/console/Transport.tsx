"use client";

import { SPEEDS, firstClamp } from "@/lib/replay";
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
  const { replay, playhead, playing, speed, length, legIndex, toggle, reset, scrub, setSpeed, jumpToClamp } =
    useReplay();
  const leg = replay?.legs[legIndex] ?? null;
  const clampAt = leg === null ? null : firstClamp(leg);
  const now = leg?.rounds[Math.min(playhead, leg.rounds.length - 1)] ?? null;

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-t border-stroke bg-inset px-3">
      <Chip onClick={toggle} title="play or pause">
        {playing ? "❚❚ pause" : "▶ play"}
      </Chip>
      <Chip onClick={reset} title="back to the first round">
        ↺ reset
      </Chip>
      <Chip onClick={jumpToClamp} disabled={clampAt === null} title="jump to the first round that hit the cap">
        ⤒ clamp
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
        {clampAt !== null && length > 1 && (
          <span
            className="pointer-events-none absolute top-0 h-full w-px bg-bad"
            style={{ left: `${(clampAt / (length - 1)) * 100}%` }}
            title="the first round that hit the cap"
          />
        )}
      </div>

      <span className="tnum shrink-0 font-mono text-[11px] text-ink-faint">
        {now === null ? "—" : `${clock(now.atSeconds)} UTC · ${playhead + 1}/${length}`}
      </span>
    </div>
  );
}
