import { expect, test } from "@playwright/test";

// Building pre-screen: the demo literal answers from the labeled example;
// any other address runs the pipeline, which in fixture-mode E2E returns the
// labeled sample report with all five sources. Live records are never
// asserted here (test:live owns that).
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
  isMobile: true,
});

test("pre-screen answers the demo literal and screens real addresses", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  const card = page.getByTestId("building-prescreen");
  await expect(card).toBeVisible();

  await card.getByTestId("prescreen-address").fill("123 Demo St (example)");
  await card.getByTestId("prescreen-check").click();
  await expect(card.getByTestId("prescreen-result")).toContainText("Illustrative example — live records not connected.");

  await card.getByTestId("prescreen-address").fill("200 N Spring St");
  await card.getByTestId("prescreen-zip").fill("90012");
  await card.getByTestId("prescreen-check").click();
  const result = card.getByTestId("prescreen-result");
  await expect(result).toContainText("Sample pre-screen — not live public records.");
  await expect(card.getByTestId("prescreen-matched")).toContainText("200 N Spring St");
  for (const key of ["ladbs", "lahd", "flood", "lead", "disasters", "hudAssisted", "epaTri", "sam"]) {
    await expect(card.getByTestId(`prescreen-source-${key}`)).toBeVisible();
  }
  await expect(card.getByTestId("prescreen-source-ladbs")).toContainText("Found");
  await expect(card.getByTestId("prescreen-source-lahd")).toContainText("None found");
  await expect(card.getByTestId("prescreen-source-flood")).toContainText("Flood Zone X");
  await expect(card.getByTestId("prescreen-source-hudAssisted")).toContainText("none flagged troubled");
  await expect(card.getByTestId("prescreen-source-epaTri")).toContainText("TRI-reporting facility");
  await expect(card.getByTestId("prescreen-source-sam")).toContainText("Skipped");
});
