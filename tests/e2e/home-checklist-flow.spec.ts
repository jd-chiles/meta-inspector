import { test, expect } from "@playwright/test";

import { expectNoViewportOverflow, goToCapture, openProfilePanel } from "./navigation";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
  isMobile: true,
});

test("home leads through film into the requirement-by-requirement checklist", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByTestId("synthetic-data-banner")).toBeVisible();
  await expect(page.getByTestId("analysis-mode")).toHaveText("Sample only");

  const home = page.getByTestId("inspection-home");
  await expect(page.getByRole("heading", { level: 1, name: "Inspection home" })).toBeVisible();
  await expectNoViewportOverflow(page, "Inspection home");
  await expect(home.getByRole("list", { name: "Inspection progress" }).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByTestId("saved-inspections").getByRole("listitem")).toHaveCount(1);
  await expect(home.getByText("0 of 11 decided", { exact: false }).first()).toBeVisible();
  // One entrance: the single Start button opens the guided tour.
  await expect(home.getByTestId("start-guided-tour")).toHaveText(/Start inspection/);
  await expect(home.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  // Voice-first launch: a fresh home leads with the voice agent entry.
  await expect(home.getByTestId("home-voice-entry")).toContainText("answer by voice");

  await goToCapture(page);
  const setupToggle = page.getByTestId("capture-setup-toggle");
  if (await setupToggle.getAttribute("aria-expanded") !== "true") await setupToggle.click();
  await page.getByLabel("Unit pseudonym").fill("Staged Home Flow Unit");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await page.getByLabel("Unit type").selectOption("studio");
  await expect(page.getByTestId("walkthrough-video-capture")).toBeVisible();
  await expect(page.getByTestId("capture-next-bar")).toContainText("0 of 4 rooms filmed");

  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inspection home" })).toBeVisible();

  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Requirement checklist" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Checklist progress" })).toBeVisible();
  await expect(page.locator("#element-overview-list").getByRole("listitem")).toHaveCount(11);

  await page.locator("#element-overview-list").getByRole("button", { name: /Structure and materials/ }).click();
  await expect(page.getByText("Requirement 1 of 11", { exact: false })).toBeVisible();
  await expect(page.getByTestId("review-element-demo-item-05")).toBeVisible();

  await page.getByRole("button", { name: "Back to checklist", exact: true }).click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await openProfilePanel(page, "Unit & Funding");
  await expect(page.getByLabel("Unit pseudonym")).toHaveValue("Staged Home Flow Unit");
  await goToCapture(page);
  await expect(page.getByRole("heading", { level: 1, name: "Film the unit" })).toBeVisible();
});
