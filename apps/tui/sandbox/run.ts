import { drive } from "./drive.js";
import type { Scenario } from "./world.js";

/** Frames at the sizes that matter. `bun run sandbox/run.ts [scenario] [keys...]` */
const [scenario = "fresh", ...keys] = process.argv.slice(2);

for (const [cols, rows] of [
  [190, 50],
  [120, 40],
  [80, 24],
] as const) {
  const frame = await drive(cols, rows, { scenario: scenario as Scenario, keys, armed: true });
  console.log(
    `\n=== ${cols}x${rows} · ${scenario}${keys.length > 0 ? ` · [${keys.join(" ")}]` : ""} — ` +
      `${frame.rows} rows, widest ${frame.width} ===`,
  );
  for (const line of frame.lines) console.log(`|${line}|`);
  if (frame.overflows) console.log(`!! ${frame.rows} rows >= ${rows}: Ink clears the terminal here`);
}
