import { ImageResponse } from "next/og";
import { BRIDGE, CHAIN_A, CHAIN_B } from "@/lib/mark-geometry";
import { COPY } from "@/lib/copy";

export const alt = COPY.statement;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The card is generated at build time, so no binary is carried in the repo. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 72,
          padding: "0 96px",
          background: "#0a0a0a",
          color: "#f5f5f5",
        }}
      >
        <svg width="260" height="260" viewBox="0 0 1000 1000">
          <path d={CHAIN_A} fill="#f5f5f5" />
          <path d={CHAIN_B} fill="#f5f5f5" />
          <path d={BRIDGE} fill="#00ED64" />
        </svg>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 30, letterSpacing: 12, color: "#8a8a8a" }}>
            {COPY.wordmark}
          </div>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1 }}>{COPY.statement}</div>
          <div style={{ fontSize: 30, color: "#c5c5c5" }}>{COPY.tagline}</div>
        </div>
      </div>
    ),
    size,
  );
}
