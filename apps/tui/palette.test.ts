import { expect, test } from "bun:test";
import { ACCENT, LEG, UI } from "./src/theme.js";
import { LOGO_GREEN } from "./src/logo.js";

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

test("the accent is the brand's, and the mark is drawn in the same one", () => {
  // One brand colour, written down once. The logo used to carry its own copy of it, which is how a
  // palette drifts: the screen is repainted and the mark is not.
  expect(ACCENT).toBe("#00ED64");
  expect(LOGO_GREEN).toBe(ACCENT);
});

test("the ink is the branding's ladder, not white on black", () => {
  // #f5f5f5 · #c5c5c5 · #8a8a8a · #4a4a4a, which is the same ladder the web surfaces use. Pure white
  // on near-black is the one combination the reference deliberately avoids.
  expect(UI.heading).toBe("#f5f5f5");
  expect(UI.muted).toBe("#8a8a8a");
  expect(UI.frame).toBe("#4a4a4a");
  expect(UI.disabled).toBe("#4a4a4a");
  expect(UI.heading).not.toBe("#ffffff");
  expect(UI.action).not.toBe("#ffffff");
});

test("the provider dots keep green, yellow and red, which is what was asked for", () => {
  // Severity is brightness everywhere else in the branding; these three were asked for as hues and
  // stay hues, because a row of dots is read without reading anything beside it.
  expect(hsl(UI.fill).h).toBeGreaterThan(80);
  expect(hsl(UI.fill).h).toBeLessThan(160);
  expect(hsl(UI.caveat).h).toBeGreaterThan(35);
  expect(hsl(UI.caveat).h).toBeLessThan(70);
  expect(apart(hsl(UI.rejection).h, 0)).toBeLessThan(20);
});

