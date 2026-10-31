import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("guide FAB walks a fresh user from setup toward filming", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();

  const fab = page.getByTestId("guide-fab");
  await expect(fab, "guide entry point is always visible").toBeVisible();
  await expect(fab).toContainText("Step 1 of 5");

  await fab.click();
  const sheet = page.getByTestId("guide-sheet");
  await expect(sheet).toBeVisible();
  await page.screenshot({ path: "artifacts/design-qa/guide-sheet-390.png" });
  await expect(sheet.getByTestId("guide-step-setup")).toHaveAttribute("data-state", "current");
  await expect(sheet.getByTestId("guide-step-film")).toHaveAttribute("data-state", "locked");
  await expect(sheet.getByTestId("guide-step-review")).toHaveAttribute("data-state", "locked");
  await expect(sheet.getByTestId("guide-step-signoff")).toHaveAttribute("data-state", "locked");
  await expect(sheet.getByTestId("guide-step-export")).toHaveAttribute("data-state", "locked");

  await sheet.getByTestId("guide-step-setup").click();
  await expect(sheet, "choosing a step closes the sheet").toBeHidden();
  await expect(page.getByTestId("capture-setup-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Unit pseudonym"), "setup action focuses the first field").toBeFocused();

  await page.getByLabel("Unit pseudonym").fill("Guide Demo Unit");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await expect(fab, "completing setup advances the guide").toContainText("Step 2 of 5");

  await fab.click();
  await expect(sheet.getByTestId("guide-step-setup")).toHaveAttribute("data-state", "done");
  await expect(sheet.getByTestId("guide-step-film")).toHaveAttribute("data-state", "current");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(fab, "closing returns focus to the entry point").toBeFocused();
});

test("guide stays hidden on the HUD route, which has no walkthrough here", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await page.getByTestId("inspection-home").getByRole("button", { name: "Continue", exact: false }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Film the unit" })).toBeVisible();
  const setupToggle = page.getByTestId("capture-setup-toggle");
  if ((await setupToggle.getAttribute("aria-expanded")) !== "true") await setupToggle.click();
  await page.getByLabel("Unit pseudonym").fill("Guide HUD Unit");
  await page.getByLabel("Funding type").selectOption("hud");
  await expect(page.getByTestId("guide-fab")).toHaveCount(0);
});
