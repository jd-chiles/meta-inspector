import { readFile } from "node:fs/promises";
import path from "node:path";

import { test, expect } from "@playwright/test";

import { expectNoViewportOverflow, goToCapture, setupProfile } from "./navigation";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
  isMobile: true,
});

test("AI guide opens from the nav tab with no second entrance before the flow starts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByTestId("analysis-mode")).toHaveText("Sample only");

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const guideTab = navigation.getByRole("button", { name: "Guide", exact: true });
  await expect(guideTab, "guide entry point is always visible").toBeVisible();
  await guideTab.click();

  const guide = page.getByTestId("assistant-guide");
  await expect(guide).toBeVisible();
  await expectNoViewportOverflow(page, "assistant guide open");
  // Single entrance: before the flow starts the guide points at Start and
  // offers no setup/film actions of its own.
  await expect(guide.getByText("Start your inspection", { exact: true })).toBeVisible();
  // On a phone the guide must open as a compact banner, not a half-screen card.
  const toggle = guide.getByTestId("assistant-guide-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const collapsedBox = await guide.boundingBox();
  expect(collapsedBox?.height ?? 9999).toBeLessThan(844 * 0.3);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(guide.getByText("Tap Start inspection on Home to begin", { exact: false })).toBeVisible();
  await expect(guide.locator("button[class*='primaryButton']")).toHaveCount(0);
  await expect(guide.getByRole("button", { name: "Set up the unit", exact: true })).toHaveCount(0);

  const voiceToggle = guide.getByRole("button", { name: /voice guide/ });
  await expect(voiceToggle).toHaveAttribute("aria-pressed", "true");
  await voiceToggle.click();
  await expect(voiceToggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("voice-guide-enabled-v1"))).toBe("off");

  await guide.getByRole("button", { name: "Close the AI inspection guide", exact: true }).click();
  await expect(guide).toBeHidden();
  await expect(guideTab).toBeVisible();
});

test("AI guide offers the next room once the flow has evidence", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  // Enter through the single entrance and film one room via the tour link.
  await page.getByTestId("start-guided-tour").click();
  const tour = page.getByTestId("guided-tour");
  await expect(tour).toBeVisible();
  await tour.getByTestId("tour-start").click();
  await tour.getByTestId("tour-options").getByRole("button", { name: "Studio", exact: true }).click();
  await tour.getByTestId("tour-options").getByRole("button", { name: "1", exact: true }).click();
  await page.getByTestId("tour-consent-confirm").click();
  await expect(tour).toHaveAttribute("data-node", "film-room:kitchen");
  await tour.getByTestId("tour-open-capture").click();
  await expect(page.getByRole("heading", { level: 1, name: "Film the unit" })).toBeVisible();

  // Setup alone is not flow evidence: still no guide entry actions.
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await navigation.getByRole("button", { name: "Guide", exact: true }).click();
  const guide = page.getByTestId("assistant-guide");
  await expect(guide).toBeVisible();
  await expect(guide.locator("button[class*='primaryButton']")).toHaveCount(0);
  await guide.getByRole("button", { name: "Close the AI inspection guide", exact: true }).click();

  // One saved clip starts the flow: the guide now offers the next room.
  const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "synthetic-guide-kitchen.mp4",
    mimeType: "video/mp4",
    buffer: videoBytes,
  });
  await expect(page.getByText("1 of 4 clips saved", { exact: true }).first()).toBeVisible();
  await navigation.getByRole("button", { name: "Guide", exact: true }).click();
  await expect(guide.getByText("Step 2 of 4: film the Bathroom", { exact: true })).toBeVisible();
  await guide.getByTestId("assistant-guide-toggle").click();
  await guide.getByRole("button", { name: "Film the Bathroom", exact: true }).click();
  await expect(page.getByTestId("walkthrough-video-capture")).toBeVisible();
});

test("home offers a fresh inspection when progress exists", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  const home = page.getByTestId("inspection-home");
  await expect(home.getByRole("button", { name: "New inspection", exact: true })).toBeVisible();

  await setupProfile(page, { pseudonym: "Staged Fresh Start Unit", funding: "lahsa", unitType: "studio" });
  await goToCapture(page);

  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Home", exact: true }).click();
  await expect(home.getByRole("button", { name: "Continue inspection", exact: false })).toBeVisible();
  await home.getByRole("button", { name: "Start new inspection", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Film the unit" })).toBeVisible();
  await expect(page.getByLabel("Unit pseudonym")).toHaveValue("");
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByTestId("saved-inspections")).toContainText("Staged Fresh Start Unit");
  await expect(page.getByTestId("saved-inspections")).toContainText("2 saved on this device");
});

test("saved inspections list, switch, and delete without losing the other", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  const home = page.getByTestId("inspection-home");

  await setupProfile(page, { pseudonym: "Unit Alpha", funding: "lahsa", unitType: "studio" });
  await goToCapture(page);
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Home", exact: true }).click();

  await home.getByRole("button", { name: "Start new inspection", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Film the unit" })).toBeVisible();
  const setupToggle2 = page.getByTestId("capture-setup-toggle");
  if (await setupToggle2.getAttribute("aria-expanded") !== "true") await setupToggle2.click();
  await page.getByLabel("Unit pseudonym").fill("Unit Bravo");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await page.getByLabel("Unit type").selectOption("studio");
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Home", exact: true }).click();

  const saved = page.getByTestId("saved-inspections");
  await expect(saved).toContainText("2 saved on this device");
  await saved.getByRole("button", { name: "Open inspection Unit Alpha", exact: true }).click();
  await expect(page.getByRole("button", { name: "Profile", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page.getByLabel("Unit pseudonym")).toHaveValue("Unit Alpha");

  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Home", exact: true }).click();
  page.on("dialog", (dialog) => dialog.accept());
  await saved.getByRole("button", { name: "Delete inspection Unit Bravo", exact: true }).click();
  await expect(saved).toContainText("1 saved on this device");
  await expect(saved).not.toContainText("Unit Bravo");
  await expect(saved).toContainText("Unit Alpha");
});
