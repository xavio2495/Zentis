import { expect, test } from "bun:test";
import { LEG, UI } from "./src/theme.js";

const hsl = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r!, g!, b!);
  const min = Math.min(r!, g!, b!);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g! - b!) / d) % 6);
    else if (max === g) h = 60 * ((b! - r!) / d + 2);
    else h = 60 * ((r! - g!) / d + 4);
  }
  return { h: (h + 360) % 360, s, l };
};
const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

test("no chain colour is grey, which reads as disabled", () => {
  for (const colour of Object.values(LEG)) expect(hsl(colour).s).toBeGreaterThan(0.35);
});

test("no chain colour borrows a hue that means error, warning or fresh", () => {
  // Sepolia was red, the colour of a rejected row. A viewer should never have to ask whether a leg's
  // name is coloured because it failed.
  for (const colour of Object.values(LEG)) {
    for (const reserved of [UI.rejection, UI.caveat, UI.fill]) {
      expect(apart(hsl(colour).h, hsl(reserved).h)).toBeGreaterThan(30);
    }
  }
});

test("the three chains are told apart from each other at a glance", () => {
  const hues = Object.values(LEG).map((c) => hsl(c).h);
  for (let i = 0; i < hues.length; i += 1) {
    for (let j = i + 1; j < hues.length; j += 1) expect(apart(hues[i]!, hues[j]!)).toBeGreaterThan(35);
  }
});
