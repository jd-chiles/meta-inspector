import { test, expect, type Page } from "@playwright/test";

// Single AI surface: the floating guide popup is gone. The guided tour is
// the only AI surface; these specs prove no popup exists on any step and
// the tour still opens from the single entrance.
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
  isMobile: true,
  permissions: ["camera", "microphone"],
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : { channel: "chromium" as const }),
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

async function expectNoPopup(page: Page): Promise<void> {
  await expect(page.getByTestId("ai-guide")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guide", exact: true })).toHaveCount(0);
}

test("no guide popup exists on any step; the tour is the single AI surface", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expectNoPopup(page);

  await page.getByTestId("start-guided-tour").click();
  const tour = page.getByTestId("guided-tour");
  await expect(tour).toBeVisible();
  await expectNoPopup(page);

  // Drive a few tour nodes: still exactly one AI surface.
  await tour.getByTestId("tour-start").click();
  await expect(tour).toHaveAttribute("data-node", "ask-unit");
  await tour.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(tour).toHaveAttribute("data-node", "ask-baths");
  await expectNoPopup(page);
  await expect(tour).toHaveCount(1);

  // Manual steps have no popup either.
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expectNoPopup(page);
  await page.getByRole("button", { name: "Sign-Off", exact: true }).click();
  await expectNoPopup(page);
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expectNoPopup(page);
});
