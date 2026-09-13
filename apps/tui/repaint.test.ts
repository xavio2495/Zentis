import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

/**
 * How often a still screen repaints.
 *
 * The mark animates at about twelve frames a second, and the comment beside its timer says it runs
 * "only while a screen that shows it is up". It did not: the timer was created whatever was on
 * screen, so the live view — a dense frame of three cards, a chart and a feed — was rebuilt and
 * written twelve and a half times a second, for as long as the console was open.
 *
 * A judge leaves the console open for the length of a demo. The user's did thirty minutes and
 * reached 3.4 GB: a quarter of a million frames of transient strings, which the allocator never
 * gave back. The fix is not to make the frames cheaper. It is to stop drawing them when nothing
 * has changed.
 */
test("the live view is still when the book is still", async () => {
  // Four seconds of quiet, measured over a window rather than an instant: mounting settles over the
  // first second, and what matters is the rate afterwards. The age on screen counts up once a
  // second and that is the whole of it — about one repaint a second, against the twelve and a half
  // this used to do. The old behaviour would put fifty frames in this window.
  const frame = await drive(120, 40, { watchMs: 4_000 });
  expect(frame.repaints).toBeLessThanOrEqual(8);
}, 60_000);

test("the mark still animates where it is the thing being watched", async () => {
  // The first screen is a mark being drawn: there the twelve frames a second are the point, and a
  // screen that stopped animating would look like a console that had hung.
  const frame = await drive(120, 40, { onboarding: true, watchMs: 1_500 });
  expect(frame.repaints).toBeGreaterThan(8);
}, 60_000);

test("a console still waiting for its first read keeps its spinner turning", async () => {
  const frame = await drive(120, 40, { scenario: "loading", watchMs: 1_500 });
  expect(frame.repaints).toBeGreaterThan(8);
}, 60_000);
