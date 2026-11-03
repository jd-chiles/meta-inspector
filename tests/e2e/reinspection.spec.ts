/**
 * Browser acceptance for REQ-L1 re-inspection mode. The webServer is pinned
 * to APP_ANALYSIS_MODE=fixture with no provider credentials passed by the
 * shared suite, so every decision below is manual and no step can reach
 * live inference. All content is limited to staged/mock-unit labels and
 * evaluator-entered text.
 *
 * A generated H.264 test pattern covers local upload, browser decoding, and
 * source-still extraction for the one deficient decision. This does not
 * validate camera capture or live SAM/Muse behavior.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { test, expect, type Locator, type Page } from "@playwright/test";

import { goToCapture, openProfilePanel, selectRoom } from "./navigation";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 360, height: 800 },
  isMobile: true,
});

async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByTestId("analysis-mode")).toHaveText("Sample only");
}

async function setLahsaProfile(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await openProfilePanel(page, "Unit & Funding");
  await page.getByLabel("Unit pseudonym").fill("Staged Demo Unit 04");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await page.getByLabel("Unit type").selectOption("studio");
  await openProfilePanel(page, "Evaluator");
  await page.getByLabel("Evaluator agency name").fill("Staged Demo Agency");
  await openProfilePanel(page, "Landlord & Agency");
  await page.getByLabel("Discussed with landlord?").selectOption("no");
  await openProfilePanel(page, "Evaluator");
}

async function markCurrentElementAcceptable(activeElement: Locator): Promise<void> {
  if (await activeElement.getAttribute("data-testid") === "review-element-demo-smoke-co") {
    await activeElement.getByRole("group", { name: "Evaluator check for Form 1083 section 11a unit detectors" })
      .getByRole("button", { name: "A · Meets", exact: true }).click();
    await activeElement.getByRole("group", { name: "Evaluator check for Form 1083 section 11b public and common area detectors" })
      .getByRole("button", { name: "A · Meets", exact: true }).click();
    return;
  }
  await activeElement.getByRole("button", { name: "A · Acceptable", exact: true }).click();
}

async function expandReviewDisclosure(element: Locator, label: RegExp): Promise<void> {
  const details = element.locator("details").filter({ hasText: label });
  const isOpen = await details.evaluate((node) => (node as HTMLDetailsElement).open);
  if (!isOpen) await details.locator("summary").click();
}

async function uploadRequiredRoomClips(page: Page, existingRoomIds: readonly string[] = []): Promise<void> {
  const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  const rooms = ["kitchen", "bathroom", "living-room", "hallway"] as const;
  const alreadySaved = new Set(existingRoomIds);
  let savedCount = alreadySaved.size;
  for (const roomId of rooms) {
    if (alreadySaved.has(roomId)) continue;
    await selectRoom(page, roomId);
    await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
      name: `synthetic-${roomId}-test-pattern.mp4`,
      mimeType: "video/mp4",
      buffer: videoBytes,
    });
    await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
    savedCount += 1;
    await expect(page.getByText(`${savedCount} of 4 clips saved`, { exact: true })).toBeVisible();
  }
}

async function browserCanDecodeH264(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const nativeCanDecode = document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"') !== "";
    if (typeof VideoDecoder === "undefined") return nativeCanDecode;
    try {
      const webCodecs = await VideoDecoder.isConfigSupported({
        codec: "avc1.42E01E",
        codedWidth: 320,
        codedHeight: 180,
      });
      return nativeCanDecode || webCodecs.supported === true;
    } catch {
      return nativeCanDecode;
    }
  });
}

/**
 * Drive the guided tour from its welcome node until it queues a review-item
 * node, answering setup and in-person checks by tap. Returns the review-item
 * node key (for example "review-item:demo-water-supply").
 */
async function driveTourToReviewItem(page: Page): Promise<string> {
  const tour = page.getByTestId("guided-tour");
  await expect(tour).toBeVisible();
  await tour.getByTestId("tour-voice-toggle").click();
  for (let step = 0; step < 40; step += 1) {
    const node = (await tour.getAttribute("data-node")) ?? "";
    if (node.startsWith("review-item:")) return node;
    if (node === "finish") {
      throw new Error("The guided tour finished without queueing a review item.");
    }
    const start = tour.getByTestId("tour-start");
    if (await start.isVisible()) { await start.click(); continue; }
    const options = tour.getByTestId("tour-options").getByRole("button");
    if (await options.first().isVisible()) { await options.first().click(); continue; }
    const consent = tour.getByTestId("tour-consent-confirm");
    if (await consent.isVisible()) { await consent.click(); continue; }
    const yes = tour.getByTestId("tour-check-yes");
    if (await yes.isVisible()) { await yes.click(); continue; }
    const analyzeContinue = tour.getByTestId("tour-analyze-continue");
    if (await analyzeContinue.isVisible()) { await analyzeContinue.click(); continue; }
    throw new Error(`The guided tour stalled at unexpected node "${node}".`);
  }
  throw new Error("The guided tour did not reach a review item within 40 steps.");
}

async function signEvaluator(page: Page): Promise<void> {
  await page.getByLabel("Type your name to sign").fill("Mock Evaluator");
  await page.getByRole("checkbox", { name: /I evaluated this unit to the best of my ability/ }).check();
  const signInspection = page.getByRole("button", { name: "Sign inspection", exact: true });
  await expect(signInspection).toBeEnabled();
  await signInspection.click();
}

async function signParticipant(page: Page): Promise<void> {
  await page.getByLabel("Participant name", { exact: true }).fill("Mock Participant");
  await page.getByLabel("Type participant name to sign", { exact: true }).fill("Mock Participant");
  await page.getByRole("checkbox", { name: /walked through this unit/ }).check();
  const signParticipantButton = page.getByRole("button", { name: "Sign as participant", exact: true });
  await expect(signParticipantButton).toBeEnabled();
  await signParticipantButton.click();
  await expect(page.getByText(/Participant sign-off saved to this device/)).toBeVisible();
}

test("re-inspection queues only the deficient element, then unblocks sign-off", async ({ page }) => {
  test.setTimeout(180_000);
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(video\/segment|analyze)/.test(request.url())) providerRequests.push(request.url());
  });
  const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));

  await openApp(page);
  await setLahsaProfile(page);
  await page.getByLabel("Evaluator name").fill("Mock Evaluator");
  await goToCapture(page);
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "synthetic-h264-test-pattern.mp4",
    mimeType: "video/mp4",
    buffer: videoBytes,
  });

  if (!await browserCanDecodeH264(page)) {
    await expect(page.getByRole("alert").filter({ hasText: "could not decode the selected video" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("No video recorded for this room yet.")).toBeVisible();
    expect(providerRequests).toHaveLength(0);
    return;
  }

  await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("1 of 4 clips saved", { exact: true })).toBeVisible();
  await uploadRequiredRoomClips(page, ["kitchen"]);
  await selectRoom(page, "kitchen");
  await page.getByRole("button", { name: "Review", exact: true }).click();

  // One deficient decision with a linked source still and a full plan.
  const overview = page.getByRole("region", { name: "All 11 inspection elements" });
  const overviewButtons = overview.locator("#element-overview-list").getByRole("button");
  const waterSupplyRow = overviewButtons.filter({ hasText: "Water supply" });
  await waterSupplyRow.click();
  const waterSupply = page.getByTestId("review-element-demo-water-supply");
  await expandReviewDisclosure(waterSupply, /Source video frames/);
  await expect(waterSupply.getByRole("img", { name: /Kitchen source frame/ })).toHaveCount(3);
  await waterSupply.getByRole("button", { name: "D · Deficient", exact: true }).click();
  await waterSupply.getByLabel("Evaluator observation").fill("The kitchen faucet keeps dripping after shutoff.");
  await waterSupply.getByRole("group", { name: "Attach source stills to your decision" }).getByRole("checkbox").first().check();
  await waterSupply.getByLabel("Deficient area / observed issue").fill("Kitchen faucet drips after it is closed.");
  await waterSupply.getByLabel("Required correction").fill("Repair the faucet cartridge and verify that it shuts off.");
  await waterSupply.getByLabel("Completion date").fill("2026-11-02");
  await waterSupply.getByLabel("Reinspection date").fill("2026-11-05");
  await page.getByRole("button", { name: "Save evaluator decision", exact: true }).click();
  await expect(waterSupplyRow).toContainText("Deficient");

  // The overview re-sorts hardest-first after every save, so always open
  // the next undecided requirement instead of a fixed position.
  const openButtons = overview.locator("#element-overview-list").getByRole("button", { name: /Open/ });
  for (let index = 0; index < 10; index += 1) {
    await openButtons.first().click();
    const activeElement = page.locator('[data-testid^="review-element-"]');
    await expect(activeElement).toBeVisible();
    await markCurrentElementAcceptable(activeElement);
    await page.getByLabel("Evaluator observation").fill("I assessed this item in person in the staged unit.");
    await page.getByRole("button", { name: "Save evaluator decision", exact: true }).click();
  }
  await expect(page.getByText("11 of 11 reviewed", { exact: true })).toBeVisible();

  // Dual attestation on a record with a standing deficiency.
  await page.getByRole("button", { name: "Sign-Off", exact: true }).click();
  await signEvaluator(page);
  await expect(page.getByTestId("inspection-result")).toHaveText("Not Approved");
  await signParticipant(page);

  // Home offers re-inspection for the signed, deficient record.
  await page.getByRole("button", { name: "Home", exact: true }).click();
  const savedInspections = page.getByTestId("saved-inspections");
  const reinspect = savedInspections.getByRole("button", { name: "Re-inspect deficiencies for Staged Demo Unit 04", exact: true });
  await expect(reinspect).toBeVisible();
  await reinspect.click();
  await expect(page.getByText(/Re-inspection started: 1 deficient item reset for review\./)).toBeVisible();

  // The guided tour queues only the reset deficiency.
  const reviewNode = await driveTourToReviewItem(page);
  expect(reviewNode).toBe("review-item:demo-water-supply");
  const tour = page.getByTestId("guided-tour");
  const reviewCard = tour.getByTestId("tour-review-card");
  await expect(reviewCard.getByRole("heading", { name: "Water supply" })).toBeVisible();
  await expect(reviewCard).toContainText("item 1 of 1");
  await expect(tour.getByTestId("tour-reinspection-tag")).toContainText("Kitchen faucet drips after it is closed.");

  // Re-decide that element acceptable; the prior deficiency stays visible
  // as Before stills while the new decision is recorded.
  await tour.getByTestId("tour-review-draft").click();
  const recheck = page.getByTestId("review-element-demo-water-supply");
  await expect(recheck).toBeVisible();
  await expect(page.getByTestId("before-deficiency-demo-water-supply")).toContainText("Prior issue:");
  await markCurrentElementAcceptable(recheck);
  await page.getByLabel("Evaluator observation").fill("The faucet cartridge was repaired; shutoff verified in person.");
  await page.getByRole("button", { name: "Save evaluator decision", exact: true }).click();
  await expect(page.getByText("11 of 11 reviewed", { exact: true })).toBeVisible();

  // With every re-inspected item acceptable, both sign-offs are available
  // again and the inspection completes.
  await page.getByRole("button", { name: "Sign-Off", exact: true }).click();
  await signEvaluator(page);
  await expect(page.getByTestId("inspection-result")).toHaveText("Approved");
  await signParticipant(page);
  expect(providerRequests, "re-inspection review and sign-off must not call a provider").toHaveLength(0);
});
