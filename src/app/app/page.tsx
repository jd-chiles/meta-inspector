// Walkthrough app lives at /app — landing owns "/"
// Server component only. Credentials never enter the browser bundle.
import MoveInReadyFlow, { type AnalysisMode } from "../../features/walkthrough/move-in-ready-flow";

export const dynamic = "force-dynamic";

export default function WalkthroughPage() {
  const modeSetting = process.env.APP_ANALYSIS_MODE;
  const analysisMode: AnalysisMode =
    modeSetting === "live" ? "live" : modeSetting === "fixture" ? "fixture" : "unconfigured";
  const esVoiceConfigured = Boolean((process.env.FISH_VOICE_ID_ES ?? "").trim());
  return <MoveInReadyFlow analysisMode={analysisMode} esVoiceConfigured={esVoiceConfigured} />;
}
