import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { expectNoViewportOverflow, goToCapture } from "./navigation";

// Capture dashboard: the camera viewport + record actions stay pinned at
// the top while the rest of the capture step scrolls beneath, and saving a
// clip brings the yes/no checks into view without manual scrolling.
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
  isMobile: true,
});

async function openReadyCapture(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByTestId("analysis-mode")).toHaveText("Sample only");
  await goToCapture(page);
  const setupToggle = page.getByTestId("capture-setup-toggle");
  if (await setupToggle.getAttribute("aria-expanded") !== "true") await setupToggle.click();
  await page.getByLabel("Unit pseudonym").fill("Staged Demo Unit 04");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await page.getByLabel("Unit type").selectOption("studio");
  await expect(page.getByTestId("walkthrough-video-capture")).toBeVisible();
}

test("viewport dock shows the camera and record action without scrolling", async ({ page }) => {
  await openReadyCapture(page);
  const dock = page.getByTestId("capture-viewport-dock");
  await expect(dock).toBeVisible();
  const box = await dock.boundingBox();
  expect(box, "dock is on screen").not.toBeNull();
  expect(box!.y, "dock starts inside the viewport").toBeGreaterThanOrEqual(0);
  expect(box!.y, "dock starts without scrolling").toBeLessThan(844);
  await expect(dock.getByRole("button", { name: "Start recording", exact: true })).toBeVisible();
  await expectNoViewportOverflow(page, "dashboard dock");
});

test("viewport dock stays pinned while the capture step scrolls", async ({ page }) => {
  // Short viewport plus a saved clip so the capture step actually scrolls.
  await page.setViewportSize({ width: 360, height: 640 });
  await openReadyCapture(page);
  await uploadKitchenClip(page);
  const dock = page.getByTestId("capture-viewport-dock");
  await expect(dock).toBeVisible();
  await page.locator("#main-content").evaluate((element) => element.scrollTo(0, 99999));
  await expect(dock).toBeVisible();
  const box = await dock.boundingBox();
  const mainBox = await page.locator("#main-content").boundingBox();
  expect(box, "dock is on screen after scrolling").not.toBeNull();
  expect(Math.abs(box!.y - mainBox!.y), "dock sticks to the scroller top").toBeLessThanOrEqual(2);
  await expect(dock.getByRole("button", { name: "Replace clip", exact: true })).toBeVisible();
  // The dock must not cover navigation or break the layout.
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation).toBeVisible();
  const navBox = await navigation.boundingBox();
  expect(box!.y + box!.height, "dock stays clear of navigation").toBeLessThanOrEqual(navBox!.y);
  await expectNoViewportOverflow(page, "dashboard dock scrolled");
});

async function uploadKitchenClip(page: Page): Promise<void> {
  const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "synthetic-kitchen-test-pattern.mp4",
    mimeType: "video/mp4",
    buffer: videoBytes,
  });
  await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
}

test("saving a clip brings the yes/no checks into view", async ({ page }) => {
  test.setTimeout(90_000);
  await openReadyCapture(page);
  await uploadKitchenClip(page);
  const checks = page.getByTestId("room-checks");
  await expect(checks).toBeVisible({ timeout: 20_000 });
  // The save transition smooth-scrolls; poll until it settles.
  await expect.poll(async () => {
    const settled = await checks.boundingBox();
    return settled ? settled.y + settled.height : 99999;
  }, { timeout: 8000 }).toBeLessThanOrEqual(844);
  const box = await checks.boundingBox();
  expect(box, "checks are on screen").not.toBeNull();
  expect(box!.y, "checks scrolled into view").toBeGreaterThanOrEqual(0);
  await expect(checks.getByRole("button", { name: "Answer", exact: true }).first()).toBeVisible();
});
