import { test, expect, type Page } from "@playwright/test";

import { goToCapture, openProfilePanel } from "./navigation";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 360, height: 800 },
});

async function openReviewSummary(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByTestId("analysis-mode")).toHaveText("Sample only");

  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await openProfilePanel(page, "Unit & Funding");
  await page.getByLabel("Unit pseudonym").fill("Staged Demo Unit 04");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await openProfilePanel(page, "Evaluator");
  await page.getByLabel("Evaluator name").fill("Synthetic Evaluator");
  await page.getByLabel("Evaluator agency name").fill("Staged Demo Agency");
  await openProfilePanel(page, "Landlord & Agency");
  await page.getByLabel("Discussed with landlord?").selectOption("no");

  await goToCapture(page);
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Draft Review" })).toBeVisible();
}

test("mobile review opens dedicated all-elements and single-element screens", async ({ page }) => {
  await openReviewSummary(page);

  const elementList = page.locator("#element-overview-list");
  const rows = elementList.getByRole("listitem");
  await expect(rows).toHaveCount(4);
  const overviewGaps = await rows.evaluateAll((items) => items.slice(1).map((item, index) => {
    const previous = items[index]?.getBoundingClientRect();
    const current = item.getBoundingClientRect();
    return current.top - (previous?.bottom ?? current.top);
  }));
  expect(Math.max(...overviewGaps), "the four-row mobile review overview should stay compact").toBeLessThanOrEqual(12);
  const finalRowBottom = await rows.last().evaluate((item) => item.getBoundingClientRect().bottom);
  const viewAllTop = await page.getByRole("button", { name: "View all 11 elements", exact: true })
    .evaluate((button) => button.getBoundingClientRect().top);
  expect(viewAllTop - finalRowBottom, "the all-elements link should follow the compact list").toBeLessThanOrEqual(24);

  await page.getByRole("button", { name: "View all 11 elements", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "All review elements", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Draft Review", exact: true })).toBeHidden();
  await expect(rows).toHaveCount(11);

  const expectedLabels = [
    "Structure and materials",
    "Access",
    "Space and security",
    "Interior air quality / ventilation",
    "Water supply",
    "Sanitary facilities",
    "Thermal environment",
    "Lighting and electricity",
    "Food preparation and refuse disposal",
    "Sanitary condition",
    "Fire safety",
  ];
  for (const label of expectedLabels) {
    await expect(elementList.getByRole("listitem").filter({ hasText: label })).toHaveCount(1);
  }

  // The dedicated list is not the four-row summary with its overview/sign-off actions.
  await expect(page.getByRole("button", { name: "View all 11 elements", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue to sign-off", exact: true })).toHaveCount(0);

  await elementList.getByRole("button", { name: /Structure and materials/ }).click();
  const visibleDetails = page.locator('[data-testid^="review-element-"]:visible');
  await expect(page.getByTestId("review-element-demo-item-05")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Structure and materials", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "All 11 inspection elements" })).toBeHidden();
  await expect(visibleDetails).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Back to all 11 elements", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save evaluator decision", exact: true })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeHidden();

  await page.getByRole("button", { name: "Back to all 11 elements", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "All review elements", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "All 11 inspection elements" })).toBeVisible();
  await expect(rows).toHaveCount(11);

  await elementList.getByRole("button", { name: /Structure and materials/ }).click();
  await page.getByRole("button", { name: "Back to all 11 elements", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "All review elements", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to review summary", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Draft Review", exact: true })).toBeVisible();
  await expect(rows).toHaveCount(4);
  await expect(elementList.locator("button[aria-pressed='true']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View all 11 elements", exact: true })).toBeVisible();
});

test("mobile Add Note saves and restores a local inspection note", async ({ page }) => {
  await openReviewSummary(page);

  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Add Note", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Inspection note", exact: true }).fill("Check the staged kitchen window latch during the walkthrough.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Draft Review", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit note", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("Note saved on this device: Check the staged kitchen window latch during the walkthrough.", { exact: true })).toBeVisible();
});
