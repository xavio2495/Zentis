import { ImageResponse } from "next/og";
import { BRIDGE, CHAIN_A, CHAIN_B } from "@/lib/mark-geometry";

/**
 * The touch icon, generated rather than committed.
 *
 * A PNG in the repository is a copy of the mark that no test can compare to the original, and it
 * goes stale silently the first time the logo is redrawn. Drawn here from the same three paths
 * everything else uses, so it cannot.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#00ED64" }}>
        <svg viewBox="0 0 1000 1000" width={180} height={180}>
          <path d={CHAIN_A} fill="#0a0a0a" fillRule="evenodd" clipRule="evenodd" />
          <path d={BRIDGE} fill="#0a0a0a" />
          <path d={CHAIN_B} fill="#0a0a0a" fillRule="evenodd" clipRule="evenodd" />
        </svg>
      </div>
    ),
    size,
  );
}
