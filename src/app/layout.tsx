import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import BootSplash from "./boot-splash";
import ServiceWorkerRegistration from "./service-worker-registration";
import "./globals.css";
import "./walkthrough.css";

const SPLASH_CSS = `
#app-splash{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:#f4f7f4;padding:1.5rem;transition:opacity .3s ease}
#app-splash.app-splash-hide{opacity:0}
.app-splash-card{width:100%;max-width:22rem;background:#fff;border:1px solid #bdccc5;border-radius:14px;padding:2rem 1.5rem;text-align:center;box-shadow:0 8px 28px rgba(23,42,39,.10)}
.app-splash-mark{display:block;margin:0 auto .75rem}
.app-splash-title{margin:0;font:700 1.1rem/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#172a27}
.app-splash-sub{margin:.15rem 0 1rem;font:400 .85rem/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#50645f}
.app-splash-spinner{width:2rem;height:2rem;margin:0 auto .75rem;border:3px solid #bdccc5;border-top-color:#176b5b;border-radius:50%;animation:app-splash-spin 1s linear infinite}
.app-splash-status{margin:0;min-height:2.6em;font:400 .85rem/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#50645f}
@keyframes app-splash-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){#app-splash{transition:none}.app-splash-spinner{animation:none;border-top-color:#bdccc5}}
`;

export const metadata: Metadata = {
  title: {
    default: "Meta Inspect — Move-in Ready",
    template: "%s · Meta Inspect",
  },
  description:
    "Move-in Ready by Meta Inspect: mobile-first LAHSA Form 1083 room-video walkthrough for staged mock units, with human-reviewed evidence and local/manual exports. Not an HMIS submission.",
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
        <style dangerouslySetInnerHTML={{ __html: SPLASH_CSS }} />
        <div id="app-splash" role="status" aria-label="Loading the walkthrough app">
          <div className="app-splash-card">
            <svg className="app-splash-mark" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
              <rect x="8" y="6" width="24" height="28" rx="4" fill="none" stroke="#176b5b" strokeWidth="2.5" />
              <rect x="15" y="3" width="10" height="6" rx="2" fill="#176b5b" />
              <path d="M14 20l5 5 7-9" fill="none" stroke="#176b5b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="app-splash-title">Meta Inspect</p>
            <p className="app-splash-sub">Move-in Ready · Mock-unit pilot</p>
            <div className="app-splash-spinner" aria-hidden="true" />
            <p className="app-splash-status" id="app-splash-status">Loading…</p>
          </div>
        </div>
        <ServiceWorkerRegistration />
        <BootSplash />
        {children}
      </body>
    </html>
  );
}
