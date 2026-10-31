import { test, expect } from "@playwright/test";

import { expectNoViewportOverflow } from "./navigation";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
  isMobile: true,
});

test("AI guide opens from the nav tab and walks setup then filming", async ({ page }) => {
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
  await expect(guide.getByText("Let's set up this inspection", { exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Set up the unit", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Film the unit" })).toBeVisible();
  await expect(page.getByTestId("capture-setup-toggle")).toHaveAttribute("aria-expanded", "true");

  await page.getByLabel("Unit pseudonym").fill("Staged Assistant Unit");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await expect(guide.getByText("Step 1 of 4: film the Kitchen", { exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Film the Kitchen", exact: true }).click();
  await expect(page.getByText("0 of 4 clips saved", { exact: true }).first()).toBeVisible();

  const voiceToggle = guide.getByRole("button", { name: /voice guide/ });
  await expect(voiceToggle).toHaveAttribute("aria-pressed", "true");
  await voiceToggle.click();
  await expect(voiceToggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("voice-guide-enabled-v1"))).toBe("off");

  await guide.getByRole("button", { name: "Close the AI inspection guide", exact: true }).click();
  await expect(guide).toBeHidden();
  await expect(guideTab).toBeVisible();
});

test("home offers a fresh inspection when progress exists", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  const home = page.getByTestId("inspection-home");
  await expect(home.getByRole("button", { name: "New inspection", exact: true })).toBeVisible();

  await home.getByRole("button", { name: "Continue", exact: false }).first().click();
  const setupToggle = page.getByTestId("capture-setup-toggle");
  if (await setupToggle.getAttribute("aria-expanded") !== "true") await setupToggle.click();
  await page.getByLabel("Unit pseudonym").fill("Staged Fresh Start Unit");
  await page.getByLabel("Funding type").selectOption("lahsa");

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

  await home.getByRole("button", { name: "Continue", exact: false }).first().click();
  const setupToggle = page.getByTestId("capture-setup-toggle");
  if (await setupToggle.getAttribute("aria-expanded") !== "true") await setupToggle.click();
  await page.getByLabel("Unit pseudonym").fill("Unit Alpha");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Home", exact: true }).click();

  await home.getByRole("button", { name: "Start new inspection", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Film the unit" })).toBeVisible();
  const setupToggle2 = page.getByTestId("capture-setup-toggle");
  if (await setupToggle2.getAttribute("aria-expanded") !== "true") await setupToggle2.click();
  await page.getByLabel("Unit pseudonym").fill("Unit Bravo");
  await page.getByLabel("Funding type").selectOption("lahsa");
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
