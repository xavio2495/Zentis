import { expect, test } from "bun:test";
import { panelInner } from "./src/components/Panel.js";

test("a panel's child is told exactly the region it has", () => {
  // The border is two columns and two rows. Every call site derives its child's size from here so
  // none of them can disagree with the box they are drawn in.
  expect(panelInner(80, 24)).toEqual({ width: 78, height: 22 });
  expect(panelInner(40, 6)).toEqual({ width: 38, height: 4 });
});
