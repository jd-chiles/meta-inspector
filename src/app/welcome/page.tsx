import type { Metadata } from "next";
import LandingClient, {} from "../landing";
import "../landing.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WalkthroughKit — Check any LA building before you visit",
  description: "Free 30-second pre-screen: LADBS cases, LAHD violations, FEMA flood, HUD lead & assisted housing, EPA emissions, disaster history, and SAM.gov federal exclusions + entity identity. Address is looked up, never saved.",
  openGraph: {
    title: "WalkthroughKit — Pre-screen any LA building in 30 seconds",
    description: "Free public records — LADBS, LAHD, FEMA, HUD, EPA, SAM.gov. The address is looked up, never saved.",
    url: "https://walkthroughkit.com",
    siteName: "WalkthroughKit",
    type: "website",
  },
};

export default function LandingPage() {
  const modeSetting = process.env.APP_ANALYSIS_MODE;
  const analysisMode: "live" | "fixture" | "unconfigured" =
    modeSetting === "live" ? "live" : modeSetting === "fixture" ? "fixture" : "unconfigured";
  return <LandingClient analysisMode={analysisMode} />;
}
