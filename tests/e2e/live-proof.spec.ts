import { test, expect, type Page } from "@playwright/test";

import { goToCapture, openProfilePanel } from "./navigation";

// Live-proof loop with simulated SAM tracking: the /api/video/track response
// is intercepted so this spec proves the app loop (camera → overlay → clip →
// draft), not the provider. Live provider proof is a separate manual run.
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

async function completeCaptureSetup(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await openProfilePanel(page, "Unit & Funding");
  await page.getByLabel("Unit pseudonym").fill("Staged Live Demo Unit");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await page.getByLabel("Unit type").selectOption("studio");
  await goToCapture(page);
}

test("live proof card lists the four provable elements with a human-check escape", async ({ page }) => {
  test.setTimeout(90_000);
  await completeCaptureSetup(page);

  const card = page.getByTestId("live-proof-card");
  await expect(card).toBeVisible();
  for (const elementId of ["demo-water-supply", "demo-interior-air", "demo-item-07", "demo-smoke-co"]) {
    await expect(page.getByTestId(`live-proof-row-${elementId}`)).toBeVisible();
  }

  const waterRow = page.getByTestId("live-proof-row-demo-water-supply");
  await waterRow.getByRole("button", { name: "Film proof" }).click();
  const capture = page.getByTestId("live-capture");
  await expect(capture).toBeVisible();
  await expect(capture).toContainText("turn the faucet on");
  await capture.getByTestId("live-needs-check").click();
  await expect(waterRow).toContainText("Check");
});

test("live proof records a tracked clip and previews the draft before saving", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("/api/video/track", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        tracked: true,
        concept: "ventilation fan",
        width: 640,
        height: 360,
        boxes: [{ left: 100, top: 80, right: 220, bottom: 200 }],
      }),
    });
  });
  await completeCaptureSetup(page);

  const fanRow = page.getByTestId("live-proof-row-demo-interior-air");
  await fanRow.getByRole("button", { name: "Film proof" }).click();
  const capture = page.getByTestId("live-capture");
  await expect(capture).toBeVisible();
  await capture.getByTestId("live-start").click();
  await capture.getByTestId("live-record").click();
  await expect(page.getByTestId("live-rec")).toBeVisible();
  await expect(page.getByTestId("live-boxes").locator("span")).toHaveCount(1, { timeout: 15_000 });
  const stopButton = capture.getByTestId("live-stop");
  await expect(stopButton).toBeEnabled({ timeout: 15_000 });
  await stopButton.click();
  await expect(fanRow).toContainText("Saved", { timeout: 20_000 });
  await expect(fanRow).toContainText("frames");

  await fanRow.getByTestId("live-draft-demo-interior-air").click();
  const preview = page.getByTestId("live-draft-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("unreviewed, not saved yet");
  await preview.getByTestId("live-draft-save").click();
  await expect(fanRow).toContainText("Draft");
});
