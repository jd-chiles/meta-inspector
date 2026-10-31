import { test, expect, type Page } from "@playwright/test";

import { expectNoViewportOverflow, goToCapture, openProfilePanel } from "./navigation";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 360, height: 800 },
  isMobile: true,
});

async function openReviewSummary(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByTestId("analysis-mode")).toHaveText("Sample only");

  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await openProfilePanel(page, "Unit & Funding");
  await page.getByLabel("Unit pseudonym").fill("Staged Demo Unit 04");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await page.getByLabel("Unit type").selectOption("studio");
  await openProfilePanel(page, "Evaluator");
  await page.getByLabel("Evaluator name").fill("Synthetic Evaluator");
  await page.getByLabel("Evaluator agency name").fill("Staged Demo Agency");
  await openProfilePanel(page, "Landlord & Agency");
  await page.getByLabel("Discussed with landlord?").selectOption("no");

  await goToCapture(page);
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Requirement checklist" })).toBeVisible();
  await expectNoViewportOverflow(page, "Requirement checklist");
}

test("mobile review shows all 11 rows and opens single-element screens", async ({ page }) => {
  await openReviewSummary(page);

  const elementList = page.locator("#element-overview-list");
  const rows = elementList.getByRole("listitem");
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

  // Sign-off stays hidden until every requirement is decided.
  await expect(page.getByRole("button", { name: "Continue to sign-off", exact: true })).toHaveCount(0);

  await elementList.getByRole("button", { name: /Structure and materials/ }).click();
  const visibleDetails = page.locator('[data-testid^="review-element-"]:visible');
  await expect(page.getByTestId("review-element-demo-item-05")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Structure and materials", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "All 11 inspection elements" })).toBeHidden();
  await expect(visibleDetails).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Back to checklist", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save evaluator decision", exact: true })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeHidden();

  await page.getByRole("button", { name: "Back to checklist", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Requirement checklist", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "All 11 inspection elements" })).toBeVisible();
  await expect(rows).toHaveCount(11);
  await expect(elementList.locator("button[aria-pressed='true']")).toHaveCount(0);
});

test("mobile Add Note saves and restores a local inspection note", async ({ page }) => {
  await openReviewSummary(page);

  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Add Note", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Inspection note", exact: true }).fill("Check the staged kitchen window latch during the walkthrough.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Requirement checklist", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit note", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("Note saved on this device: Check the staged kitchen window latch during the walkthrough.", { exact: true })).toBeVisible();
});
