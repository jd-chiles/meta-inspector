import { readFile } from "node:fs/promises";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import { expectNoViewportOverflow } from "./navigation";

// Guided voice tour: the agent narrates each step and the screen mirrors it.
// Specs mute the guide voice and prove the conversation flow (speak/answer/
// advance), not audio output. Mic answers use the fake media stream with an
// intercepted transcription, so no provider is touched.
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

async function startTour(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await page.getByTestId("start-guided-tour").click();
  await expect(page.getByTestId("guided-tour")).toBeVisible();
  await page.getByTestId("tour-voice-toggle").click();
  await expect(page.getByTestId("guided-tour")).toHaveAttribute("data-node", "welcome");
  await page.getByTestId("tour-start").click();
}

test("tour setup takes unit type, baths, and one consent tap, then opens the camera", async ({ page }) => {
  test.setTimeout(90_000);
  await startTour(page);
  const tour = page.getByTestId("guided-tour");

  await expect(tour).toHaveAttribute("data-node", "ask-unit");
  await expect(page.getByTestId("tour-agent-bar")).toBeVisible();
  await tour.getByRole("button", { name: "1 bedroom", exact: true }).click();

  await expect(tour).toHaveAttribute("data-node", "ask-baths");
  await tour.getByRole("button", { name: "1", exact: true }).click();

  await expect(tour).toHaveAttribute("data-node", "consent");
  await expect(page.getByTestId("tour-instruction")).toContainText("consent");
  await expectNoViewportOverflow(page, "tour consent");
  await page.getByTestId("tour-consent-confirm").click();

  await expect(tour).toHaveAttribute("data-node", "film-room:kitchen");
  await expect(page.getByTestId("tour-instruction")).toContainText("Kitchen");
  await expect(page.getByTestId("tour-shot-list")).toBeVisible();
  await expect(page.getByTestId("tour-shot-list")).toContainText("faucet");
  await expect(page.getByTestId("walkthrough-video-capture")).toBeVisible();
  await expectNoViewportOverflow(page, "tour film room");
});

test("a spoken unit-type answer advances the tour without tapping", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/api/voice/transcribe", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, text: "two bedroom" }),
  }));
  await startTour(page);
  const tour = page.getByTestId("guided-tour");
  await expect(tour).toHaveAttribute("data-node", "ask-unit");

  await tour.getByRole("button", { name: "Answer by voice", exact: true }).click();
  await expect(tour.getByText("Listening… tap Stop when done.")).toBeVisible();
  // Let mic acquisition finish so Stop lands on a live recorder.
  await page.waitForTimeout(2000);
  await tour.getByRole("button", { name: "Stop", exact: true }).click();

  await expect(tour).toHaveAttribute("data-node", "ask-baths");
});

test("skipping a missing room advances the tour past it", async ({ page }) => {
  test.setTimeout(90_000);
  await startTour(page);
  const tour = page.getByTestId("guided-tour");
  await expect(tour).toHaveAttribute("data-node", "ask-unit");
  await tour.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(tour).toHaveAttribute("data-node", "ask-baths");
  await tour.getByRole("button", { name: "1", exact: true }).click();
  await expect(tour).toHaveAttribute("data-node", "consent");
  await page.getByTestId("tour-consent-confirm").click();
  await expect(tour).toHaveAttribute("data-node", "film-room:kitchen");
  await tour.getByTestId("tour-skip-room").click();
  await expect(tour).toHaveAttribute("data-node", "film-room:bathroom");
});

test("a spoken name saves with a yes and reaches draft-less review", async ({ page }) => {
  test.setTimeout(240_000);
  const transcripts = ["Rae Evaluator", "yes"];
  await page.route("**/api/voice/transcribe", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, text: transcripts.shift() ?? "" }),
  }));
  const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  await startTour(page);
  const tour = page.getByTestId("guided-tour");

  // Studio keeps the room list to four so this stays fast.
  await expect(tour).toHaveAttribute("data-node", "ask-unit");
  await tour.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(tour).toHaveAttribute("data-node", "ask-baths");
  await tour.getByRole("button", { name: "1", exact: true }).click();
  await expect(tour).toHaveAttribute("data-node", "consent");
  await page.getByTestId("tour-consent-confirm").click();

  // Film every room and tap through its in-person checks. Each step waits
  // for the node to actually turn over: instant reads race the async save.
  for (let room = 0; room < 6; room += 1) {
    const key = await tour.getAttribute("data-node");
    if (key === "analyze") break;
    await expect(tour).toHaveAttribute("data-node", /^film-room:/);
    await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
      name: `synthetic-tour-${room}.mp4`,
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
  await expect(tour).toHaveAttribute("data-node", "analyze");
  await page.getByTestId("tour-analyze-continue").click();

  // Voice fills the name draft, reads it back, and a yes saves it.
  await expect(tour).toHaveAttribute("data-node", "ask-name");
  for (let turn = 0; turn < 2; turn += 1) {
    await tour.getByRole("button", { name: "Answer by voice", exact: true }).click();
    await expect(tour.getByText("Listening… tap Stop when done.")).toBeVisible();
    await page.waitForTimeout(2000);
    await tour.getByRole("button", { name: "Stop", exact: true }).click();
    if (turn === 0) await expect(page.getByTestId("tour-name-input")).toHaveValue("Rae Evaluator");
  }
  // Fixture mode yields no AI drafts: every element still gets its review
  // question, starting with a decide-it-yourself card.
  await expect(tour).toHaveAttribute("data-node", "review-item:demo-smoke-co");
  await expect(tour.getByTestId("tour-review-card")).toBeVisible();
  await expect(tour.getByText("No AI draft", { exact: false })).toBeVisible();
  await tour.getByTestId("tour-needs-check").click();
  await expect(tour).toHaveAttribute("data-node", "review-item:demo-item-06");

  // Draft-less review: the detail form opens prefilled with the spoken
  // in-person answers, and saving records the check with no checkbox.
  await tour.getByTestId("tour-review-draft").click();
  const detail = page.getByTestId("review-element-demo-item-06");
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("checkbox", { name: /in-person check/ })).toHaveCount(0);
  await detail.getByRole("button", { name: "A · Acceptable" }).click();
  await expect(detail.getByLabel("Evaluator observation")).toHaveValue(/Voice checks:/);
  // Mobile hides the inline save button; the sticky review footer saves.
  await page.getByRole("button", { name: "Save evaluator decision" }).click();
  await expect(detail.getByText("Approved")).toBeAttached();
});

