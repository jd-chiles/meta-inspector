import { expect, type Page } from "@playwright/test";

/** Unit setup through Profile (always editable). Reaching capture via the tour auto-completes setup, so specs that need specific values set them here first. */
export async function setupProfile(page: Page, setup: { pseudonym: string; funding: string; unitType: string }): Promise<void> {
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await openProfilePanel(page, "Unit & Funding");
  await page.getByLabel("Unit pseudonym").fill(setup.pseudonym);
  await page.getByLabel("Funding type").selectOption(setup.funding);
  await page.getByLabel("Unit type").selectOption(setup.unitType);
}

/** Manual capture is reached from Home's room grid (the one path: the tour films inline and never ejects). When setup is incomplete the room buttons stay disabled, so drive the tour's setup nodes first — consent auto-completes setup — then exit back to Home. */
export async function goToCapture(page: Page): Promise<void> {
  const captureHeading = page.getByRole("heading", { level: 1, name: "Film the unit" });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await captureHeading.isVisible()) return;

    const home = page.getByTestId("inspection-home");
    if (await home.isVisible()) {
      const roomButton = home.getByTestId("home-room-kitchen");
      if (await roomButton.isVisible() && await roomButton.isEnabled()) {
        await roomButton.click();
        continue;
      }
      // No setup yet: the Start button opens the tour; drive setup, exit.
      await home.getByTestId("start-guided-tour").click();
    }
    const tour = page.getByTestId("guided-tour");
    if (await tour.isVisible()) {
      for (let drive = 0; drive < 12; drive += 1) {
        if (await captureHeading.isVisible()) return;
        const start = tour.getByTestId("tour-start");
        if (await start.isVisible()) { await start.click(); continue; }
        const options = tour.getByTestId("tour-options").getByRole("button");
        if (await options.first().isVisible()) { await options.first().click(); continue; }
        const consent = tour.getByTestId("tour-consent-confirm");
        if (await consent.isVisible()) { await consent.click(); continue; }
        // Setup nodes are done once filming starts; exit to Home's room grid.
        const node = (await tour.getAttribute("data-node")) ?? "";
        if (node.startsWith("film-room:") || node.startsWith("room-check:")) {
          await tour.getByTestId("tour-exit").click();
          continue;
        }
        const yes = tour.getByTestId("tour-check-yes");
        if (await yes.isVisible()) { await yes.click(); continue; }
        break;
      }
      if (await captureHeading.isVisible()) return;
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
