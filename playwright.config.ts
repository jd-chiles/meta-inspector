import { defineConfig } from "@playwright/test";

// Fixture-only browser acceptance: the production server under test boots with
// APP_ANALYSIS_MODE=fixture and no Meta key, so no step can reach live
// inference. Use a dedicated loopback port so Playwright never reuses the
// separately running phone preview (which may point to an older checkout).
// `npm run test:e2e` builds first, then this webServer boots that build.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3101",
    // The upload/decode specs need real H.264 decoding, which the headless
    // shell lacks. Default to the full Playwright-managed Chromium build;
    // an explicit executable path still wins when provided.
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } }
      : { launchOptions: { channel: "chromium" } }),
  },
  webServer: {
    command: "npm run start -- --port 3101 -H 127.0.0.1",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ANALYSIS_MODE: "fixture",
      // Do not let locally configured provider credentials enter the shared
      // fixture server process. The E2E suite only needs mocked responses.
      META_API_KEY: "",
      BASETEN_API_KEY: "",
      MODEL_API_KEY: "",
    },
  },
});
