import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import ServiceWorkerRegistration from "./service-worker-registration";
import "./globals.css";
import "./walkthrough.css";

export const metadata: Metadata = {
  title: {
    default: "Habitability Walkthrough Companion",
    template: "%s · Habitability Walkthrough Companion",
  },
  description:
    "A mobile-first LAHSA Form 1083 room-video walkthrough for staged mock units, with human-reviewed evidence and local/manual exports. Not an HMIS submission.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b5cad",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/fonts/public-sans-latin-400-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/public-sans-latin-700-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
