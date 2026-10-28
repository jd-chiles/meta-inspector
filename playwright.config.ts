import { defineConfig } from "@playwright/test";

// Fixture-only browser acceptance: the production server under test boots with
// APP_ANALYSIS_MODE=fixture and no Meta key, so no step can reach live
// inference. `npm run test:e2e` builds first, then this webServer boots the
// production build (`next start`) for the specs in tests/e2e.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
  },
  webServer: {
    command: "npm run start -- --port 3100 -H 127.0.0.1",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      APP_ANALYSIS_MODE: "fixture",
    },
  },
});
