import { mkdir } from "node:fs/promises";
import path from "node:path";

import { test, expect } from "@playwright/test";

import { goToCapture } from "./navigation";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 1365, height: 900 },
});

test("desktop Capture uses five-tab navigation and places prompts beside the video", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByTestId("analysis-mode")).toHaveText("Sample only");
  await expect(page.getByRole("heading", { level: 1, name: "Inspection home" })).toBeVisible();

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("button")).toHaveCount(5);
  for (const label of ["Home", "Guide", "Review", "Sign-Off", "Profile"]) {
    await expect(navigation.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(navigation).toHaveCSS("position", "sticky");

  await goToCapture(page);
  const captureSetup = page.getByRole("button", { name: /Inspection setup/ });
  if (await captureSetup.getAttribute("aria-expanded") !== "true") await captureSetup.click();
  await page.getByLabel("Unit pseudonym").fill("Staged Desktop Layout Unit");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await page.getByLabel("Unit type").selectOption("studio");

  const capture = page.getByTestId("walkthrough-video-capture");
  await expect(page.getByRole("heading", { level: 1, name: "Film the unit" })).toBeVisible();
  await expect(capture.getByRole("heading", { name: "Filming guide" })).toBeVisible();
  await expect(capture.getByRole("button", { name: "Upload video", exact: true })).toBeVisible();
  await expect(capture.getByText("Up to 30 seconds. Move slowly: run the faucet and show drainage; pan the sink, counters and outlets; show the running fan and smoke/CO detector. Film the front door and lock in the hallway.", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Not filmed", { exact: true }).first()).toBeVisible();

  const geometry = await capture.evaluate((root) => {
    const bounds = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) throw new Error("Expected desktop Capture layout element was missing.");
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width };
    };
    const template = getComputedStyle(root).gridTemplateColumns;
    const styles = getComputedStyle(root);
    const horizontalInsets = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight) +
      Number.parseFloat(styles.borderLeftWidth) + Number.parseFloat(styles.borderRightWidth);
    return {
      columns: template.trim().split(/\s+/).length,
      container: bounds(root),
      horizontalInsets,
      roomHeader: bounds(root.querySelector('[class*="roomHeader"]')),
      preview: bounds(root.querySelector('[class*="previewFrame"]')),
      prompts: bounds(root.querySelector('[class*="prompts"]')),
    };
  });
  expect(geometry.columns).toBe(2);
  expect(Math.abs(geometry.roomHeader.width - (geometry.container.width - geometry.horizontalInsets))).toBeLessThan(2);
  expect(geometry.prompts.left).toBeGreaterThan(geometry.preview.right);
  expect(Math.abs(geometry.prompts.top - geometry.preview.top)).toBeLessThan(8);
  expect(geometry.prompts.right).toBeLessThanOrEqual(1365);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await expect(capture.getByRole("listitem")).toHaveCount(1);
  await expect(capture.getByText("One clip per room. Assess in person.", { exact: true })).toBeVisible();
  await expect(capture.getByRole("button", { name: /View all \d+ prompts/ })).toHaveCount(0);

  await mkdir(path.join(process.cwd(), "artifacts/design-qa"), { recursive: true });
  await page.screenshot({ path: "artifacts/design-qa/capture-desktop-final-1365.png" });

  await navigation.getByRole("button", { name: "Review", exact: true }).click();
  const elementList = page.locator("#element-overview-list");
  await elementList.getByRole("button", { name: /Structure and materials/ }).click();
  await expect(elementList.locator("button[aria-pressed='true']")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "Requirement checklist", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to home", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Requirement checklist", exact: true })).toBeVisible();
  await elementList.getByRole("button", { name: /Structure and materials/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Requirement checklist", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to home", exact: true })).toBeVisible();
  await expect(page.getByTestId("review-element-demo-item-05")).toBeVisible();
  await expect(elementList.locator("button[aria-pressed='true']")).toHaveCount(1);
  await page.getByRole("button", { name: "Back to home", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inspection home", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Requirement checklist", exact: true })).toBeVisible();
  await expect(elementList.locator("button[aria-pressed='true']")).toHaveCount(1);
  await expect(page.getByTestId("review-element-demo-item-05")).toBeVisible();
});
