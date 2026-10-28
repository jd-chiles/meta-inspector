import { defineConfig } from "vitest/config";

// Deterministic unit checks only: no network, no provider keys, no browser.
// Vitest fails by default when no test files match, so required checks can
// never silently pass with zero tests (REQ-012).
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    environment: "node",
  },
});
