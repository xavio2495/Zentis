import { Text } from "ink";
import type { Seg } from "../layout.js";

/** Renders a measured row. Nothing here decides what fits; `fitSegments` already did. */
export const Segments = ({ segs }: { segs: Seg[] }) => (
  <>
    {segs.map((seg, i) => (
      <Text key={i} color={seg.color} bold={seg.bold === true}>
        {seg.text}
      </Text>
    ))}
  </>
);
