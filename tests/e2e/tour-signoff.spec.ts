import { readFile } from "node:fs/promises";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import { openProfilePanel } from "./navigation";

// Full 1083 walk: the tour drives every input — setup, film, checks,
// analysis (explicit tap only), all 11 decisions, agency, landlord,
// leadership, participant, and evaluator sign-off — to a signed finish.
// Fixture mode (no providers): decisions save through the detail form.
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

async function backToTour(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByTestId("start-guided-tour").click();
  const tour = page.getByTestId("guided-tour");
  await expect(tour).toBeVisible();
  // Tour UI state (welcome/baths/analyze) is memory-only, so re-entry
  // re-confirms it with explicit taps; saved data resumes underneath.
  for (let drive = 0; drive < 4; drive += 1) {
    const key = await tour.getAttribute("data-node");
    if (key === "welcome") {
      await tour.getByTestId("tour-start").click();
      continue;
    }
    if (key === "ask-baths") {
      await tour.getByRole("button", { name: "1", exact: true }).click();
      continue;
    }
    if (key === "analyze") {
      await page.getByTestId("tour-analyze-continue").click();
      continue;
    }
    break;
  }
}

test("the tour walks every 1083 input to a signed finish", async ({ page }) => {
  test.setTimeout(540_000);
  const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await page.getByTestId("start-guided-tour").click();
  const tour = page.getByTestId("guided-tour");
  await expect(tour).toBeVisible();
  await tour.getByTestId("tour-voice-toggle").click();
  await tour.getByTestId("tour-start").click();

  // Studio keeps the room list short.
  await expect(tour).toHaveAttribute("data-node", "ask-unit");
  await tour.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(tour).toHaveAttribute("data-node", "ask-baths");
  await tour.getByRole("button", { name: "1", exact: true }).click();
  await expect(tour).toHaveAttribute("data-node", "consent");
  await expect(page.getByTestId("tour-consent-path")).toContainText("LAHSA / Form 1083 path");
  await page.getByTestId("tour-consent-confirm").click();

  for (let room = 0; room < 6; room += 1) {
    const key = await tour.getAttribute("data-node");
    if (key === "analyze") break;
    await expect(tour).toHaveAttribute("data-node", /^film-room:/);
    await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
      name: `synthetic-signoff-${room}.mp4`,
      mimeType: "video/mp4",
      buffer: videoBytes,
    });
    await expect(tour).not.toHaveAttribute("data-node", key ?? "never");
    for (let check = 0; check < 3; check += 1) {
      const before = await tour.getAttribute("data-node");
      if (before === "analyze" || (before ?? "").startsWith("film-room:")) break;
      await expect(tour).toHaveAttribute("data-node", /^room-check:/);
      await tour.getByTestId("tour-check-yes").click();
      await expect(tour).not.toHaveAttribute("data-node", before ?? "never");
    }
  }

  // Paid analysis never auto-starts: the node holds until tapped.
  await expect(tour).toHaveAttribute("data-node", "analyze");
  await page.waitForTimeout(2000);
  await expect(tour).toHaveAttribute("data-node", "analyze");
  await page.getByTestId("tour-analyze-continue").click();

  // Typed name path (voice path is covered in guided-tour.spec.ts).
  await expect(tour).toHaveAttribute("data-node", "ask-name");
  await page.getByTestId("tour-name-input").fill("Rae Evaluator");
  await page.getByTestId("tour-name-save").click();

  // Decide all 11 through the detail form, returning to the tour each time.
  for (let decided = 0; decided < 11; decided += 1) {
    const key = await tour.getAttribute("data-node");
    if (!key?.startsWith("review-item:")) break;
    const elementId = key.slice("review-item:".length);
    await tour.getByTestId("tour-review-draft").click();
    const detail = page.getByTestId(`review-element-${elementId}`);
    await expect(detail).toBeVisible();
    if (elementId === "demo-smoke-co") {
      for (const group of [
        "Evaluator check for Form 1083 section 11a unit detectors",
        "Evaluator check for Form 1083 section 11b public and common area detectors",
      ]) {
        await detail.getByRole("group", { name: group })
          .getByRole("button", { name: "A · Meets", exact: true }).click();
      }
    } else {
      await detail.getByRole("button", { name: "A · Acceptable", exact: true }).click();
    }
    await detail.getByLabel("Evaluator observation").fill("Checked in person for the tour signoff walk.");
    await page.getByRole("button", { name: "Save evaluator decision", exact: true }).click();
    await backToTour(page);
  }

  // Administrative chain in form-blocker order.
  await expect(tour).toHaveAttribute("data-node", "agency");
  await page.getByTestId("tour-agency-input").fill("LAHSA Demo");
  await expect(tour).toHaveAttribute("data-node", "landlord-discussion");
  await tour.getByRole("button", { name: "NO", exact: true }).click();

  // Leadership appears once agency policy requires it.
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await openProfilePanel(page, "Landlord & Agency");
  await page.getByRole("checkbox", { name: "Agency policy requires a leadership sign-off before export." }).check();
  await backToTour(page);
  await expect(tour).toHaveAttribute("data-node", "leadership");
  await page.getByTestId("tour-leadership-name").fill("Lee Lead, Supervisor");
  await page.getByTestId("tour-leadership-signature").fill("Lee Lead");
  await page.getByTestId("tour-leadership-date").fill("2026-11-03");

  await expect(tour).toHaveAttribute("data-node", "participant");
  await page.getByTestId("tour-participant-name").fill("Pat Participant");
  await page.getByTestId("tour-participant-signature").fill("Pat Participant");
  await page.getByTestId("tour-participant-attest").check();
  await page.getByTestId("tour-participant-save").click();

  await expect(tour).toHaveAttribute("data-node", "signoff");
  await page.getByTestId("tour-signoff-signature").fill("Rae Evaluator");
  await page.getByTestId("tour-signoff-attest").check();
  await page.getByTestId("tour-signoff-save").click();

  await expect(tour).toHaveAttribute("data-node", "finish");
  await expect(tour.getByText("Inspection complete", { exact: false })).toBeVisible();
});
