import { test, expect, type Page } from "@playwright/test";

// Single AI surface: exactly one voice surface per screen. The docked voice
// bar narrates every manual step; on the tour step the tour's own agent bar
// owns voice and the docked bar hides. The old floating popup and Guide tab
// are gone.
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
  await expect(page.getByTestId("assistant-guide")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guide", exact: true })).toHaveCount(0);
}

test("one voice surface per screen: docked bar on manual steps, tour agent bar on the tour step", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expectNoPopup(page);

  const bar = page.getByTestId("guide-voice-bar");
  const tour = page.getByTestId("guided-tour");
  await expect(bar).toBeVisible();
  await expect(tour).toHaveCount(0);

  // The bar expands to the full guidance message with mute + replay.
  await bar.getByTestId("guide-voice-bar-toggle").click();
  await expect(bar.getByTestId("guide-voice-bar-message")).toContainText("Start inspection");
  // One trigger set: the voice bar narrates and never renders flow actions.
  await expect(bar.getByRole("button", { name: "Set up the unit", exact: true })).toHaveCount(0);
  await expect(bar.getByRole("button", { name: /Film the /, exact: false })).toHaveCount(0);
  await expect(bar.getByRole("button", { name: /Confirm & analyze /, exact: false })).toHaveCount(0);
  const mute = bar.getByTestId("guide-voice-bar-mute");
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "false");
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");

  // Entering the tour swaps the bar for the tour agent bar — never both.
  await page.getByTestId("start-guided-tour").click();
  await expect(tour).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect(tour.getByTestId("tour-agent-bar")).toBeVisible();
  await expectNoPopup(page);

  await tour.getByTestId("tour-start").click();
  await expect(tour).toHaveAttribute("data-node", "ask-unit");
  await expect(bar).toHaveCount(0);

  // Leaving the tour restores the bar.
  await tour.getByTestId("tour-exit").click();
  await expect(page.getByTestId("inspection-home")).toBeVisible();
  await expect(bar).toBeVisible();

  // Manual steps keep the bar and no popup.
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(bar).toBeVisible();
  await expectNoPopup(page);
  await page.getByRole("button", { name: "Sign-Off", exact: true }).click();
  await expect(bar).toBeVisible();
  await expectNoPopup(page);
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(bar).toBeVisible();
  await expectNoPopup(page);
});
