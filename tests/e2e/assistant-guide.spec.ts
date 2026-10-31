import { test, expect } from "@playwright/test";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
});

test("AI guide opens from the FAB and walks setup then filming", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByTestId("analysis-mode")).toHaveText("Sample only");

  const fab = page.getByTestId("assistant-fab");
  await expect(fab, "guide entry point is always visible").toBeVisible();
  await fab.click();

  const guide = page.getByTestId("assistant-guide");
  await expect(guide).toBeVisible();
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
  await expect(fab).toBeVisible();
});
