import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./walkthrough.css";

export const metadata: Metadata = {
  title: {
    default: "Habitability Walkthrough Companion",
    template: "%s · Habitability Walkthrough Companion",
  },
  description:
    "Image-first prototype that helps housing navigators capture mock-unit evidence, prepare reviewable drafts, and flag manual checks. Draft for worker review — not an approved inspection or HMIS submission.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
