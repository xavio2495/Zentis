import { describe, expect, test } from "bun:test";
import {
  MARK_HALF_EXTENT,
  fieldState,
  gateShape,
  insideGate,
  pixelsPerWorldUnit,
  textColumnHalfWidth,
} from "../src/lib/field-state";

/** The viewports the field has to behave at, not just the one it was tuned on. */
const VIEWPORTS = [
  { viewportWidth: 390, viewportHeight: 844 }, // phone
  { viewportWidth: 820, viewportHeight: 1180 }, // tablet
  { viewportWidth: 1040, viewportHeight: 1150 }, // the one the defect was found at
  { viewportWidth: 1440, viewportHeight: 900 },
  { viewportWidth: 2560, viewportHeight: 1440 },
];

/** A document roughly the shape the landing builds: hero, traverse, prose, outro. */
function docHeight(viewportHeight: number) {
  return viewportHeight * 6.2;
}

describe("the field yields to the words", () => {
  for (const viewport of VIEWPORTS) {
    const { viewportWidth, viewportHeight } = viewport;
    const height = docHeight(viewportHeight);

    test(`clears or dims over every prose scroll position at ${viewportWidth}x${viewportHeight}`, () => {
      const first = fieldState({ scrollY: 0, ...viewport, docHeight: height });
      const proseFrom = first.proseFrom;
      const proseTo = first.outroFrom;
      expect(proseTo).toBeGreaterThan(proseFrom);

      for (let scrollY = proseFrom; scrollY <= proseTo; scrollY += viewportHeight / 8) {
        const state = fieldState({ scrollY, ...viewport, docHeight: height });
        const perUnit = pixelsPerWorldUnit(viewportHeight, state.positionZ);
        const halfExtentPx = MARK_HALF_EXTENT * state.scale * perUnit;
        const offsetPx = Math.abs(state.positionX) * perUnit;
        const clearsColumn = offsetPx - halfExtentPx >= textColumnHalfWidth(viewportWidth);

        // Either it is out of the column, or it is faint enough not to read as
        // texture across the paragraph.
        expect(clearsColumn || state.opacity <= 0.06).toBe(true);
      }
    });
  }
});

describe("the field still does its job", () => {
  const viewport = { viewportWidth: 1440, viewportHeight: 900 };
  const height = docHeight(viewport.viewportHeight);

  test("is present and centred on the first screen", () => {
    const state = fieldState({ scrollY: 0, ...viewport, docHeight: height });
    expect(state.positionX).toBe(0);
    expect(state.opacity).toBeGreaterThan(0.2);
  });

  test("comes toward the reader and grows through the traverse", () => {
    const start = fieldState({ scrollY: 0, ...viewport, docHeight: height });
    const end = fieldState({
      scrollY: viewport.viewportHeight * 2.2,
      ...viewport,
      docHeight: height,
    });
    expect(end.positionZ).toBeGreaterThan(start.positionZ);
    expect(end.scale).toBeGreaterThan(start.scale);
    expect(end.opacity).toBeGreaterThan(start.opacity);
  });

  test("comes back for the scatter at the end of the page", () => {
    const outro = fieldState({ scrollY: height, ...viewport, docHeight: height });
    expect(outro.scatter).toBeGreaterThan(0.9);
    expect(outro.opacity).toBeGreaterThan(0.2);
  });

  test("never leaves the mark part-way through its move", () => {
    // Whatever the scroll position, the mark is either on the centre line or
    // fully committed to its offset — never straddling the column edge.
    const state = fieldState({
      scrollY: viewport.viewportHeight * 2.4,
      ...viewport,
      docHeight: height,
    });
    const perUnit = pixelsPerWorldUnit(viewport.viewportHeight, state.positionZ);
    const halfExtentPx = MARK_HALF_EXTENT * state.scale * perUnit;
    const offsetPx = Math.abs(state.positionX) * perUnit;
    expect(
      offsetPx - halfExtentPx >= textColumnHalfWidth(viewport.viewportWidth) ||
        state.opacity <= 0.06,
    ).toBe(true);
  });
});

describe("the doorway and the field behind it", () => {
  const viewport = { viewportWidth: 1440, viewportHeight: 900 };
  const height = docHeight(viewport.viewportHeight);
  const at = (scrollY: number) => fieldState({ scrollY, ...viewport, docHeight: height });

  test("the door stands whole on the first screen", () => {
    const state = at(0);
    expect(state.doorOpacity).toBeGreaterThan(0.9);
    expect(state.doorScale).toBeCloseTo(1, 2);
  });

  test("the reader passes through it: it opens out and goes", () => {
    const middle = at(viewport.viewportHeight * 0.6);
    expect(middle.doorScale).toBeGreaterThan(1);
    expect(middle.doorOpacity).toBeLessThan(at(0).doorOpacity);
  });

  test("it is gone before the first paragraph, and stays gone", () => {
    for (const scrollY of [at(0).proseFrom, at(0).proseFrom + viewport.viewportHeight, height]) {
      expect(at(scrollY).doorOpacity).toBe(0);
    }
  });

  test("the starfield is faint at the start and opens up through the traverse", () => {
    expect(at(0).starfieldOpacity).toBeLessThan(0.3);
    expect(at(at(0).proseFrom).starfieldOpacity).toBeGreaterThan(0.5);
  });

  test("the starfield stays: it is the room the page happens in", () => {
    for (const scrollY of [at(0).proseFrom, at(0).outroFrom, height]) {
      expect(at(scrollY).starfieldOpacity).toBeGreaterThan(0.4);
    }
  });
});

describe("the gate, and the mark held inside it", () => {
  const viewport = { viewportWidth: 1440, viewportHeight: 900 };
  const height = docHeight(viewport.viewportHeight);
  const at = (scrollY: number, pointer?: { x: number; y: number }) =>
    fieldState({ scrollY, ...viewport, docHeight: height, pointer });

  test("the gate is an equilateral triangle standing on its point", () => {
    const gate = gateShape();
    // height of an equilateral triangle is side * sqrt(3) / 2
    expect(gate.height).toBeCloseTo((gate.side * Math.sqrt(3)) / 2, 4);
    // apex below, flat edge above
    expect(gate.apexY).toBeLessThan(gate.topY);
  });

  test("the mark follows the cursor", () => {
    const left = at(0, { x: -0.6, y: 0 });
    const right = at(0, { x: 0.6, y: 0 });
    expect(left.markOffsetX).toBeLessThan(0);
    expect(right.markOffsetX).toBeGreaterThan(0);
    expect(at(0, { x: 0, y: 0 }).markOffsetX).toBeCloseTo(0, 6);
  });

  test("but never outside the gate, however far the cursor goes", () => {
    for (const x of [-1, -0.5, 0, 0.5, 1]) {
      for (const y of [-1, -0.5, 0, 0.5, 1]) {
        const state = at(0, { x, y });
        expect(insideGate(state.markOffsetX, state.markOffsetY)).toBe(true);
      }
    }
  });

  test("the mark has the run of the gate, not just its middle", () => {
    const gate = gateShape();
    // it reaches out along the wide top edge
    const right = at(0, { x: 1, y: 0.55 });
    const left = at(0, { x: -1, y: 0.55 });
    expect(right.markOffsetX).toBeGreaterThan(gate.side * 0.2);
    expect(left.markOffsetX).toBeLessThan(-gate.side * 0.2);
    // and down toward the point it stands on
    const low = at(0, { x: 0, y: -1 });
    expect(low.markOffsetY).toBeLessThan(gate.apexY * 0.45);
    // and up to the top edge
    const high = at(0, { x: 0, y: 1 });
    expect(high.markOffsetY).toBeGreaterThan(gate.topY * 0.45);
  });

  test("the cursor's own position is reported for the light it casts", () => {
    const state = at(0, { x: 1, y: 1 });
    // unclamped, so effects can key off where the cursor really is
    expect(state.pointerWorldX).toBeGreaterThan(state.markOffsetX);
  });

  test("the cursor lets go once the reader is through the gate", () => {
    expect(Math.abs(at(at(0).proseFrom, { x: 1, y: 1 }).markOffsetX)).toBeLessThan(0.001);
  });

  test("no cursor, no offset", () => {
    expect(at(0).markOffsetX).toBe(0);
    expect(at(0).markOffsetY).toBe(0);
  });
});
