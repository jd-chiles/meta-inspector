import { readFile } from "node:fs/promises";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import { goToCapture, openProfilePanel, selectRoom } from "./navigation";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 360, height: 800 },
});

async function browserCanDecodeH264(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const nativeCanDecode = document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"') !== "";
    if (typeof VideoDecoder === "undefined") return nativeCanDecode;
    try {
      const webCodecs = await VideoDecoder.isConfigSupported({
        codec: "avc1.42E01E",
        codedWidth: 320,
        codedHeight: 180,
      });
      return nativeCanDecode || webCodecs.supported === true;
    } catch {
      return nativeCanDecode;
    }
  });
}

test("room prompt completion persists with a saved clip and stays room-specific", async ({ page }) => {
  test.setTimeout(90_000);
  const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  const pageHeight = await page.evaluate(() => ({
    content: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    viewport: window.innerHeight,
  }));
  expect(pageHeight.content - pageHeight.viewport, "capture should stay inside the phone shell").toBeLessThanOrEqual(1);
  await expect(page.getByTestId("analysis-mode"), "provider mode details stay with the consent and analysis controls").toBeHidden();
  test.skip(!await browserCanDecodeH264(page), "this persistence flow needs a browser that can decode the synthetic H.264 clip");

  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await openProfilePanel(page, "Unit & Funding");
  await page.getByLabel("Unit pseudonym").fill("Staged Prompt Demo Unit");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await goToCapture(page);

  await expect(page.getByText("0 of 4 captured", { exact: true })).toBeVisible();
  const currentPrompt = page.locator('[data-testid="walkthrough-video-capture"] [aria-current="step"]');
  await expect(currentPrompt).toHaveCount(1);
  await expect(currentPrompt).toContainText("Run faucet; show water flow and drainage.");
  await expect(currentPrompt).toContainText("Current prompt");
  await expect(currentPrompt).toHaveCSS("border-top-color", "rgb(143, 181, 227)");
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "prompt-kitchen-test-pattern.mp4",
    mimeType: "video/mp4",
    buffer: videoBytes,
  });
  await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Mark captured: Run faucet; show water flow and drainage.", exact: true }).click();
  await expect(page.getByText("1 of 4 captured", { exact: true })).toBeVisible();
  await expect(currentPrompt).toHaveCount(1);
  await expect(currentPrompt).toContainText("Show sink, counters, outlets, and the running fan.");

  await page.reload();
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByText("1 of 4 captured", { exact: true })).toBeVisible();
  const capturedKitchenPrompt = page.getByRole("listitem").filter({ hasText: "Run faucet; show water flow and drainage." });
  await expect(capturedKitchenPrompt.getByRole("button", { name: "Undo captured: Run faucet; show water flow and drainage.", exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="walkthrough-video-capture"] [aria-current="step"]')).toContainText("Show sink, counters, outlets, and the running fan.");

  await selectRoom(page, "bathroom");
  await expect(page.getByText("0 of 4 captured", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark captured: Run faucet or shower; show flow and drainage.", exact: true })).toHaveCount(0);
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "prompt-bathroom-test-pattern.mp4",
    mimeType: "video/mp4",
    buffer: videoBytes,
  });
  await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Mark captured: Run faucet or shower; show flow and drainage.", exact: true }).click();
  await expect(page.getByText("1 of 4 captured", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByText("1 of 4 captured", { exact: true })).toBeVisible();
  await selectRoom(page, "kitchen");
  await expect(page.getByText("1 of 4 captured", { exact: true })).toBeVisible();
});

test("replacing a room clip clears captured prompt marks with an honest notice", async ({ page }) => {
  test.setTimeout(90_000);
  const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  test.skip(!await browserCanDecodeH264(page), "this replacement flow needs a browser that can decode the synthetic H.264 clip");

  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await openProfilePanel(page, "Unit & Funding");
  await page.getByLabel("Unit pseudonym").fill("Staged Replacement Demo Unit");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await goToCapture(page);

  await expect(page.getByText("Film all steps in one take.", { exact: true })).toBeVisible();

  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "prompt-replace-first.mp4",
    mimeType: "video/mp4",
    buffer: videoBytes,
  });
  await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Mark captured: Run faucet; show water flow and drainage.", exact: true }).click();
  await expect(page.getByText("1 of 4 captured", { exact: true })).toBeVisible();
  await expect(page.getByText("Replacing it clears captured marks", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Replace clip", exact: true }).click();
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "prompt-replace-second.mp4",
    mimeType: "video/mp4",
    buffer: videoBytes,
  });
  await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("0 of 4 captured", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Captured filming-prompt marks for this room were cleared" })).toBeVisible();
  const currentPrompt = page.locator('[data-testid="walkthrough-video-capture"] [aria-current="step"]');
  await expect(currentPrompt).toContainText("Run faucet; show water flow and drainage.");
});
