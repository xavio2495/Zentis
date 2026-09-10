import { invertMid } from "@zentis/console-data";
import type { PriceSample } from "@zentis/strategy-sdk";

/**
 * A price series the way its title quotes it: one whole tokenB in tokenA, rising when tokenB gets
 * dearer.
 *
 * The chart used to plot the raw mid, which is tokenB per tokenA — WETH per USDC — under a title
 * saying `1 WETH = N USDC`. So the line fell exactly when the number in its title rose. Inverting
 * the series before plotting makes up mean up, and lets the axis be labelled in the same prices the
 * title uses.
 */
export const quoted = (samples: PriceSample[]): PriceSample[] =>
  samples.map((s) => ({ timestamp: s.timestamp, mid: invertMid(s.mid) }));
