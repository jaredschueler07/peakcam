import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Fraunces, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ClientProviders } from "./client-providers";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "700", "900"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

const BASE_URL = "https://peakcam.io";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the page extend into the notch/home-indicator areas so
  // env(safe-area-inset-*) is non-zero where components need it.
  viewportFit: "cover",
  themeColor: "#2a1f14",
};

export const metadata: Metadata = {
  title: {
    default: "PeakCam — Live Mountain Cams & Snow Reports",
    template: "%s | PeakCam",
  },
  description:
    "Live cams, snow reports, and weather forecasts for ski resorts across North & South America. " +
    "Browse 150+ resorts on an interactive map.",
  keywords: [
    "ski cams",
    "live mountain cams",
    "ski resort conditions",
    "snow report",
    "skiing",
    "live webcam ski resort",
    "powder day",
    "ski resort weather",
    "trail conditions",
    "Chile ski resorts",
    "Argentina ski resorts",
  ],
  metadataBase: new URL(BASE_URL),
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "PeakCam",
    title: "PeakCam — Live Mountain Cams & Snow Reports",
    description: "Browse live cams and snow conditions for 150+ ski resorts across North & South America.",
  },
  twitter: {
    card: "summary_large_image",
    title: "PeakCam — Live Mountain Cams",
    description: "Browse live cams and snow conditions for 150+ ski resorts across North & South America.",
  },
  robots: { index: true, follow: true },
  verification: {
    google: 'WxEYSVb48l8MEVfSy2aRBYcwIxq1hq2djwwO6UcL_Q8',
  },
};

const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "PeakCam",
  url: BASE_URL,
  logo: `${BASE_URL}/icon.png`,
  sameAs: [],
};

const websiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "PeakCam",
  url: BASE_URL,
  description: "Live webcams, snow reports, and weather forecasts for ski resorts across North America.",
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${BASE_URL}/?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}>
      <body className={`${dmSans.className} antialiased`}>
        <a href="#main-content"
           className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100]
                      focus:px-4 focus:py-2 focus:bg-forest focus:text-cream-50 focus:rounded-full focus:text-sm focus:font-semibold focus:shadow-stamp">
          Skip to main content
        </a>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }}
        />
        <ClientProviders>{children}</ClientProviders>
        <Suspense>
          <Analytics />
        </Suspense>
        <Suspense>
          <SpeedInsights />
        </Suspense>
      </body>
    </html>
  );
}
