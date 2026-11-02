import { test, expect, type Page } from "@playwright/test";

import { expectNoViewportOverflow } from "./navigation";

// Guided voice tour: the agent narrates each step and the screen mirrors it.
// Specs mute the guide voice and prove the conversation flow (speak/answer/
// advance), not audio output. Mic answers use the fake media stream with an
// intercepted transcription, so no provider is touched.
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
  isMobile: true,
  permissions: ["camera", "microphone"],
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : { channel: "chromium" as const }),
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

async function startTour(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await page.getByTestId("start-guided-tour").click();
  await expect(page.getByTestId("guided-tour")).toBeVisible();
  await page.getByTestId("tour-voice-toggle").click();
  await expect(page.getByTestId("guided-tour")).toHaveAttribute("data-node", "welcome");
  await page.getByTestId("tour-start").click();
}

test("tour setup takes unit type, baths, and one consent tap, then opens the camera", async ({ page }) => {
  test.setTimeout(90_000);
  await startTour(page);
  const tour = page.getByTestId("guided-tour");

  await expect(tour).toHaveAttribute("data-node", "ask-unit");
  await expect(page.getByTestId("tour-agent-bar")).toBeVisible();
  await tour.getByRole("button", { name: "1 bedroom", exact: true }).click();

  await expect(tour).toHaveAttribute("data-node", "ask-baths");
  await tour.getByRole("button", { name: "1", exact: true }).click();

  await expect(tour).toHaveAttribute("data-node", "consent");
  await expect(page.getByTestId("tour-instruction")).toContainText("consent");
  await expectNoViewportOverflow(page, "tour consent");
  await page.getByTestId("tour-consent-confirm").click();

  await expect(tour).toHaveAttribute("data-node", "film-room:kitchen");
  await expect(page.getByTestId("tour-instruction")).toContainText("Kitchen");
  await expect(page.getByTestId("tour-shot-list")).toBeVisible();
  await expect(page.getByTestId("tour-shot-list")).toContainText("faucet");
  await expect(page.getByTestId("walkthrough-video-capture")).toBeVisible();
  await expectNoViewportOverflow(page, "tour film room");
});

test("a spoken unit-type answer advances the tour without tapping", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/api/voice/transcribe", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, text: "two bedroom" }),
  }));
  await startTour(page);
  const tour = page.getByTestId("guided-tour");
  await expect(tour).toHaveAttribute("data-node", "ask-unit");

  await tour.getByRole("button", { name: "Answer by voice", exact: true }).click();
  await expect(tour.getByText("Listening… tap Stop when done.")).toBeVisible();
  // Let mic acquisition finish so Stop lands on a live recorder.
  await page.waitForTimeout(2000);
  await tour.getByRole("button", { name: "Stop", exact: true }).click();

  await expect(tour).toHaveAttribute("data-node", "ask-baths");
});
