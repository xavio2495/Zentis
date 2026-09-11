import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Manrope } from "next/font/google";
import "./globals.css";

// Self-hosted and latin-subset at build time: no third-party connection and no
// render-blocking font stylesheet on the critical path.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "700", "800"],
  display: "swap",
});

// The only serif voice on the page, and it is italic-only by design.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  display: "swap",
});

const SITE = "https://zentis-eth.vercel.app";
const TITLE = "Zentis — one position, three chains, no bridge";
const DESCRIPTION =
  "Zentis is a market maker that runs a single Aqua position across several chains and rebalances by pricing rather than by bridging.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "Zentis",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  viewportFit: "cover",
};

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE}/#zentis`,
      name: "Zentis",
      applicationCategory: "FinanceApplication",
      operatingSystem: "macOS, Linux",
      url: SITE,
      description: DESCRIPTION,
    },
    {
      "@type": "WebSite",
      url: SITE,
      name: "Zentis",
      inLanguage: "en",
      publisher: { "@id": `${SITE}/#zentis` },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${manrope.variable} ${instrumentSerif.variable}`}>
      <body className="locked">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
        {children}
      </body>
    </html>
  );
}
