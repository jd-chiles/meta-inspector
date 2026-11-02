import { expect, type Page } from "@playwright/test";

/** Film is reached from Home (guide action) or by contextual back on mobile. */
export async function goToCapture(page: Page): Promise<void> {
  const captureHeading = page.getByRole("heading", { level: 1, name: "Film the unit" });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await captureHeading.isVisible()) return;

    const home = page.getByTestId("inspection-home");
    if (await home.isVisible()) {
      // Home's single entrance opens the guided tour; specs reach the
      // manual capture screen through the AI guide's next action instead.
      await page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: "Guide", exact: true }).click();
      const guide = page.getByTestId("assistant-guide");
      await expect(guide).toBeVisible();
      const toggle = guide.getByTestId("assistant-guide-toggle");
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      await guide.locator("button[class*='primaryButton']").first().click();
      // The guide stays open after its action runs and its panel covers
      // content actions on later screens. Manual capture never shows it,
      // so dismiss it to restore the real flow state.
      const closeGuide = page.getByRole("button", { name: "Close the AI inspection guide", exact: true });
      if (await closeGuide.isVisible()) await closeGuide.click();
      continue;
    }

    const backButtons = [
      page.getByRole("button", { name: "Back to Capture", exact: true }),
      page.getByRole("button", { name: "Back to home", exact: true }),
      page.getByRole("button", { name: "Back to checklist", exact: true }),
      page.getByRole("button", { name: "Back to all 11 requirements", exact: true }),
      page.getByRole("button", { name: "Back to review summary", exact: true }),
      page.getByRole("button", { name: "Back to all 11 elements", exact: true }),
      page.getByRole("button", { name: "Back to review overview", exact: true }),
      page.getByRole("button", { name: "Back to Review", exact: true }),
    ];
    let navigated = false;
    for (const button of backButtons) {
      if (!(await button.isVisible())) continue;
      await button.click();
      navigated = true;
      break;
    }
    if (!navigated) break;
  }

  await expect(captureHeading).toBeVisible();
}

export async function openProfilePanel(page: Page, panelName: "Unit & Funding" | "Evaluator" | "Landlord & Agency"): Promise<void> {
  const panelToggle = page.getByRole("button", { name: panelName, exact: true });
  await expect(panelToggle).toBeVisible();
  if (await panelToggle.getAttribute("aria-expanded") !== "true") await panelToggle.click();
  await expect(panelToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("region", { name: panelName, exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Profile setup" }).getByRole("region")).toHaveCount(1);
}

/** Select one room step from the mobile Capture walkthrough. */
export async function selectRoom(page: Page, roomId: string): Promise<void> {
  const roomPicker = page.getByTestId("room-picker-toggle");
  if (await roomPicker.isVisible() && await roomPicker.getAttribute("aria-expanded") !== "true") {
    await roomPicker.click();
  }
  await page.getByTestId(`room-step-${roomId}`).click();
}

/**
 * Assert no visible element sticks out past the viewport on either side.
 * Document scrollWidth alone misses cutoff content when an ancestor clips,
 * so this scans element boxes instead.
 */
export async function expectNoViewportOverflow(page: Page, label: string): Promise<void> {
  const offenders = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const found: string[] = [];
    for (const element of document.querySelectorAll("body *")) {
      if (!(element instanceof HTMLElement)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (rect.width > viewportWidth + 1 || rect.left < -1 || rect.right > viewportWidth + 1) {
        const name = `${element.tagName.toLowerCase()}.${(element.className || "").toString().split(" ")[0] || "no-class"}`.slice(0, 80);
        found.push(`${name} L:${Math.round(rect.left)} R:${Math.round(rect.right)}`);
        if (found.length >= 5) break;
      }
    }
    return found;
  });
  expect(offenders, `${label} must keep every element inside the viewport`).toEqual([]);
}
