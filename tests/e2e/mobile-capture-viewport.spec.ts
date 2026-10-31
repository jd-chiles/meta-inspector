import { mkdir, writeFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

async function openReadyCapture(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByTestId("analysis-mode")).toHaveText("Sample only");
  const setupToggle = page.getByTestId("capture-setup-toggle");
  if (await setupToggle.getAttribute("aria-expanded") !== "true") await setupToggle.click();
  await page.getByLabel("Unit pseudonym").fill("Staged Demo Unit 04");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await expect(page.getByTestId("walkthrough-video-capture")).toBeVisible();
}

async function expectNoDocumentOverflow(page: Page, width: number, height: number): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    height: document.documentElement.scrollHeight,
  }));
  expect(dimensions.width, `${width}px Capture must not scroll horizontally`).toBeLessThanOrEqual(width + 1);
  expect(dimensions.height, `${height}px app shell must keep navigation in the viewport`).toBeLessThanOrEqual(height + 1);
}

test("390x844 Capture fills the phone workspace without leaving a dead gap above navigation", async ({ page }) => {
  await openReadyCapture(page, 390, 844);
  await mkdir("artifacts/design-qa", { recursive: true });

  const capture = page.getByTestId("walkthrough-video-capture");
  const lastPrompt = capture.getByRole("listitem").last();
  const privacyDisclosure = capture.locator("details[data-testid='saved-clip-details'] > summary");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const layout = await page.evaluate(() => {
    const main = document.querySelector("main");
    const nav = document.querySelector("nav[aria-label='Main navigation']");
    const video = document.querySelector("[data-testid='walkthrough-video-capture']");
    if (!(main instanceof HTMLElement) || !(nav instanceof HTMLElement) || !(video instanceof HTMLElement)) {
      throw new Error("Expected Capture, main scroller, or navigation was missing.");
    }
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    };
    return {
      main: box(main),
      nav: box(nav),
      capture: box(video),
      mainScrollHeight: main.scrollHeight,
      mainClientHeight: main.clientHeight,
    };
  });
  const promptBox = await lastPrompt.boundingBox();
  const privacyBox = await privacyDisclosure.boundingBox();
  expect(promptBox).not.toBeNull();
  expect(privacyBox).not.toBeNull();
  expect(layout.main.bottom).toBeLessThanOrEqual(layout.nav.top + 1);
  expect(layout.capture.bottom).toBeGreaterThanOrEqual(layout.nav.top - 32);
  expect(privacyBox!.y + privacyBox!.height).toBeLessThanOrEqual(layout.nav.top - 4);
  expect(layout.nav.top - (privacyBox!.y + privacyBox!.height), "the last Capture action should sit within 32px of navigation").toBeLessThanOrEqual(32);
  expect(layout.mainScrollHeight).toBeLessThanOrEqual(layout.mainClientHeight + 1);
  await expect(navigation.getByRole("button")).toHaveCount(3);
  await expectNoDocumentOverflow(page, 390, 844);
  await writeFile(
    "artifacts/design-qa/capture-fit-390x844-layout.json",
    JSON.stringify(
      {
        viewport: { width: 390, height: 844 },
        captureToNavigationGap: layout.nav.top - layout.capture.bottom,
        lastPromptBottomToNavigationGap: layout.nav.top - (promptBox!.y + promptBox!.height),
        lastActionBottomToNavigationGap: layout.nav.top - (privacyBox!.y + privacyBox!.height),
        mainScrollHeight: layout.mainScrollHeight,
        mainClientHeight: layout.mainClientHeight,
        horizontalOverflow: false,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: "artifacts/design-qa/capture-fit-390x844.png" });
});

test("360x640 keeps navigation fixed while Capture content scrolls inside the main pane", async ({ page }) => {
  await openReadyCapture(page, 360, 640);
  await mkdir("artifacts/design-qa", { recursive: true });

  const main = page.locator("#main-content");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const upload = page.getByRole("button", { name: "Upload video", exact: true });
  const capture = page.getByTestId("walkthrough-video-capture");
  const lastPrompt = capture.getByRole("listitem").last();
  const privacyDisclosure = capture.locator("details[data-testid='saved-clip-details'] > summary");
  const initial = await page.evaluate(() => {
    const main = document.querySelector("main");
    const nav = document.querySelector("nav[aria-label='Main navigation']");
    if (!(main instanceof HTMLElement) || !(nav instanceof HTMLElement)) throw new Error("Expected app panes were missing.");
    return {
      mainOverflow: getComputedStyle(main).overflowY,
      mainScrollHeight: main.scrollHeight,
      mainClientHeight: main.clientHeight,
      navBottom: nav.getBoundingClientRect().bottom,
      viewportHeight: innerHeight,
    };
  });
  expect(initial.mainOverflow).toBe("auto");
  expect(initial.mainScrollHeight).toBeGreaterThan(initial.mainClientHeight);
  expect(initial.navBottom).toBeLessThanOrEqual(initial.viewportHeight);
  await expect(navigation.getByRole("button", { name: "Review", exact: true })).toBeVisible();

  await upload.scrollIntoViewIfNeeded();
  const uploadBox = await upload.boundingBox();
  const navBox = await navigation.boundingBox();
  expect(uploadBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(uploadBox!.y + uploadBox!.height).toBeLessThanOrEqual(navBox!.y - 4);

  await lastPrompt.scrollIntoViewIfNeeded();
  const promptBox = await lastPrompt.boundingBox();
  expect(promptBox).not.toBeNull();
  expect(promptBox!.y + promptBox!.height).toBeLessThanOrEqual(navBox!.y - 4);
  await privacyDisclosure.scrollIntoViewIfNeeded();
  const privacyBox = await privacyDisclosure.boundingBox();
  expect(privacyBox).not.toBeNull();
  expect(privacyBox!.y + privacyBox!.height).toBeLessThanOrEqual(navBox!.y - 4);
  expect(await main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expectNoDocumentOverflow(page, 360, 640);
  const scrollMetrics = await main.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  await writeFile(
    "artifacts/design-qa/capture-fit-360x640-layout.json",
    JSON.stringify(
      {
        viewport: { width: 360, height: 640 },
        uploadBottomToNavigationGap: navBox!.y - (uploadBox!.y + uploadBox!.height),
        lastPromptBottomToNavigationGap: navBox!.y - (promptBox!.y + promptBox!.height),
        privacyDisclosureBottomToNavigationGap: navBox!.y - (privacyBox!.y + privacyBox!.height),
        mainScrollHeight: scrollMetrics.scrollHeight,
        mainClientHeight: scrollMetrics.clientHeight,
        scrollTopAfterLastPrompt: scrollMetrics.scrollTop,
        navigationBottom: navBox!.y + navBox!.height,
        horizontalOverflow: false,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: "artifacts/design-qa/capture-fit-360x640.png" });
});
