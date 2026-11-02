import { test, expect } from "@playwright/test";

// Boot splash: an inline loading card paints before scripts parse and is
// removed once the app renders, so a cold container boot never looks frozen.
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
  isMobile: true,
});

test("boot splash dismisses once the app renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.locator("#app-splash")).toHaveCount(0);
});
