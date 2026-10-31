// Server component only. Credentials and provider request data never enter the browser bundle.

import MoveInReadyFlow, { type AnalysisMode } from "../features/walkthrough/move-in-ready-flow";

export const dynamic = "force-dynamic";

export default function WalkthroughPage() {
  const modeSetting = process.env.APP_ANALYSIS_MODE;
  const analysisMode: AnalysisMode = modeSetting === "live"
    ? "live"
    : modeSetting === "fixture"
      ? "fixture"
      : "unconfigured";
  return <MoveInReadyFlow analysisMode={analysisMode} />;
}
