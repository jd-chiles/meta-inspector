/**
 * Browser acceptance for TASK-095 (REQ-005, REQ-008, REQ-009, REQ-011, REQ-012).
 *
 * Correction list + session case notes + downloadable review packet on the
 * 360px mobile journey. Fixture-only: the app server under test runs in
 * explicit fixture mode (APP_ANALYSIS_MODE=fixture, no Meta key), every
 * /api/analyze response asserted here is mock-unit output, and image uploads
 * are synthetic 1x1 PNG bytes generated in code (no people, no tenant data).
 * Nothing here proves live inference. No test is skipped and the file never
 * passes with zero assertions: every test ends in explicit expects.
 *
 * These tests fail while the per-item finding form, the session draft
 * case-notes section, or the downloadable packet wiring is absent (no
 * review-deficiency-*, case-notes-*, or export-download testids) and pass
 * once the worker flow is wired to recordDeficiency/clearDeficiency,
 * setCaseNotes/clearCaseNotes, and the stable export snapshot download.
 */
import { promises as fs } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/* Synthetic 1x1 PNG generated in code (mock-unit bytes, no fixture file). */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pngFile(name = "mock-unit.png") {
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(TINY_PNG_BASE64, "base64"),
  };
}

/* Isolated storage per test: packet counts stay exact (REQ-008). */
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Per-test storage isolation (REQ-007/REQ-008): drop any persisted session
 * rows (which carry worker findings and session case notes) and the offline
 * analysis queue before every test, then reboot the app on the clean slate.
 * Without this, a finding, draft note, or queued intent saved by one test
 * can leak into the packet counts asserted by the next test when the full
 * walkthrough suite runs in order. Storage keys mirror
 * STORAGE_DB_NAME (src/storage/db.ts) and OFFLINE_QUEUE_STORAGE_KEY
 * (src/features/walkthrough/offline.ts).
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    try {
      window.localStorage.removeItem(
        "habitability-walkthrough:offline-queue:v1",
      );
    } catch {
      /* web storage unavailable: nothing persisted to clear */
    }
    try {
      window.sessionStorage.clear();
    } catch {
      /* web storage unavailable: nothing persisted to clear */
    }
    await new Promise<void>((resolve) => {
      try {
        const request = window.indexedDB.deleteDatabase(
          "habitability-walkthrough",
        );
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
  });
  await page.reload();
  await expect(page.getByTestId("walkthrough-heading")).toBeVisible();
});

/**
 * Resolve the first checklist item id from the capture input rendered for
 * the bundled demo catalog (testids are capture-input-upload-<itemId>).
 * Fails explicitly when the guided capture UI is absent.
 */
async function resolveFirstItemId(page: Page): Promise<string> {
  const raw = await page
    .locator('[data-testid^="capture-input-upload-"]')
    .first()
    .getAttribute("data-testid");
  expect(
    raw,
    "guided capture must render an upload input per catalog item",
  ).not.toBeNull();
  const itemId = (raw as string).replace("capture-input-upload-", "");
  expect(itemId.length).toBeGreaterThan(0);
  return itemId;
}

async function allItemIds(page: Page): Promise<string[]> {
  const inputs = page.locator('[data-testid^="capture-input-upload-"]');
  await expect(inputs.first()).toBeAttached({ timeout: 20000 });
  const count = await inputs.count();
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const raw = await inputs.nth(index).getAttribute("data-testid");
    expect(raw).not.toBeNull();
    ids.push((raw as string).replace("capture-input-upload-", ""));
  }
  return ids;
}

async function uploadAndAwaitDraft(page: Page, itemId: string): Promise<void> {
  await page
    .getByTestId(`capture-input-upload-${itemId}`)
    .setInputFiles(pngFile());
  await expect(page.getByTestId(`capture-preview-${itemId}`)).toBeVisible();
  await expect(page.getByTestId(`review-draft-${itemId}`)).toBeVisible({
    timeout: 20000,
  });
}

async function recordFinding(
  page: Page,
  itemId: string,
  input: {
    issue: string;
    action: string;
    party?: string;
    date?: string;
  },
): Promise<void> {
  await page.getByTestId(`review-deficiency-open-${itemId}`).click();
  await page
    .getByTestId(`review-deficiency-issue-${itemId}`)
    .fill(input.issue);
  await page
    .getByTestId(`review-deficiency-action-${itemId}`)
    .fill(input.action);
  if (input.party !== undefined) {
    await page
      .getByTestId(`review-deficiency-party-${itemId}`)
      .fill(input.party);
  }
  if (input.date !== undefined) {
    await page
      .getByTestId(`review-deficiency-date-${itemId}`)
      .fill(input.date);
  }
  await page.getByTestId(`review-deficiency-save-${itemId}`).click();
}

async function recordAllChecksPerformed(
  page: Page,
  itemId: string,
): Promise<void> {
  const notes = page.locator(
    `[data-testid^="review-check-note-${itemId}-"]`,
  );
  const count = await notes.count();
  expect(count, "catalog must expose at least one manual check").toBeGreaterThan(
    0,
  );
  for (let index = 0; index < count; index += 1) {
    const noteInput = notes.nth(index);
    const noteTestId =
      (await noteInput.getAttribute("data-testid")) as string;
    const checkId = noteTestId.replace(`review-check-note-${itemId}-`, "");
    await noteInput.fill(`Performed by hand (${checkId}).`);
    await page
      .getByTestId(`review-check-performed-${itemId}-${checkId}`)
      .click();
  }
}

async function saveCaseNotes(page: Page, notes: string): Promise<void> {
  await page.getByTestId("case-notes-edit").click();
  await page.getByTestId("case-notes-input").fill(notes);
  await page.getByTestId("case-notes-save").click();
}

async function downloadPacket(page: Page): Promise<string> {
  const downloadButton = page.getByTestId("export-download");
  await expect(downloadButton).toBeVisible();
  await expect(downloadButton).toBeEnabled();
  const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
  await downloadButton.click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path, "packet download must land on disk").not.toBeNull();
  const html = await fs.readFile(path as string, "utf8");
  expect(html.length).toBeGreaterThan(1000);
  return html;
}

test.describe("mobile correction journey to downloadable packet (REQ-005, REQ-008, REQ-009)", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("worker records a finding and case notes, then downloads the review packet", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("walkthrough-heading")).toBeVisible();
    await expect(page.getByTestId("demo-banner")).toContainText(
      "Demo checklist — not a verified Form 1083 mapping.",
    );
    await expect(page.getByTestId("analysis-mode")).toContainText("fixture");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(
      overflow,
      "360px layout must not scroll horizontally",
    ).toBeLessThanOrEqual(1);

    const itemId = await resolveFirstItemId(page);
    await uploadAndAwaitDraft(page, itemId);

    // The finding form starts empty and never prefills AI draft text.
    await expect(
      page.getByTestId(`review-deficiency-empty-${itemId}`),
    ).toBeVisible();
    await page.getByTestId(`review-deficiency-open-${itemId}`).click();
    const prefilledIssue = await page
      .getByTestId(`review-deficiency-issue-${itemId}`)
      .inputValue();
    expect(prefilledIssue, "finding form must never prefill AI draft text").toBe(
      "",
    );
    await page.getByTestId(`review-deficiency-open-${itemId}`).click();

    await recordFinding(page, itemId, {
      issue: "Bathroom faucet drips continuously.",
      action: "Ask maintenance to reseat the washer; will recheck.",
      party: "Maintenance team",
      date: "2026-11-04",
    });
    await expect(
      page.getByTestId(`review-deficiency-display-${itemId}`),
    ).toContainText("Bathroom faucet drips continuously.");
    await expect(
      page.getByTestId(`review-deficiency-display-${itemId}`),
    ).toContainText("Maintenance team");
    await expect(
      page.getByTestId(`review-deficiency-display-${itemId}`),
    ).toContainText("2026-11-04");

    // Accept the draft, then resolve every required check by hand.
    await page.getByTestId(`review-accept-${itemId}`).click();
    await recordAllChecksPerformed(page, itemId);
    await expect(page.getByTestId(`review-checks-${itemId}`)).toContainText(
      /recorded as performed/,
    );

    // Session case notes: empty state, then a saved worker draft.
    await expect(page.getByTestId("case-notes-empty")).toBeVisible();
    await saveCaseNotes(page, "Occupant present; will recheck kitchen tap.");
    await expect(page.getByTestId("case-notes-display")).toContainText(
      "Occupant present; will recheck kitchen tap.",
    );
    await expect(page.getByTestId("case-notes-notice")).toContainText(
      "saved as a worker draft",
    );

    // The packet downloads and carries the worker records with the banner.
    const html = await downloadPacket(page);
    expect(html).toContain("Bathroom faucet drips continuously.");
    expect(html).toContain("Ask maintenance to reseat the washer");
    expect(html).toContain("Maintenance team");
    expect(html).toContain("2026-11-04");
    expect(html).toContain("Occupant present; will recheck kitchen tap.");
    expect(html).toContain("Worker deficiency list (1)");
    expect(html).toContain("Session case notes (worker draft — unreviewed)");
    expect(html).toContain("Unresolved required checks");
    expect(html).toContain(
      "Draft for worker review — not an approved inspection or HMIS submission.",
    );
    expect(html).toContain("Demo checklist — not a verified Form 1083 mapping.");
    expect(html).toContain("Local export only — stored on this device");
    // The packet is a review draft, never an approved inspection or HMIS filing.
    expect(html).not.toMatch(/is (hereby |now )?approved/i);
    expect(html).not.toMatch(/HMIS submission (confirmed|complete|approved)/i);
    expect(html).not.toContain("META_API_KEY");
  });

  test("finding form validates input, flags a changed photo, and clears", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);

    // No photo yet: recording is disabled with an explanatory note.
    await expect(
      page.getByTestId(`review-deficiency-open-${itemId}`),
    ).toBeDisabled();

    await uploadAndAwaitDraft(page, itemId);

    // Empty issue is rejected client-side with an announced error; nothing saves.
    await page.getByTestId(`review-deficiency-open-${itemId}`).click();
    await page
      .getByTestId(`review-deficiency-issue-${itemId}`)
      .fill("   ");
    await page
      .getByTestId(`review-deficiency-action-${itemId}`)
      .fill("Tighten the fixture.");
    await page.getByTestId(`review-deficiency-save-${itemId}`).click();
    await expect(
      page.getByTestId(`review-deficiency-error-${itemId}`),
    ).toContainText(/required/i);
    await expect(
      page.getByTestId(`review-deficiency-display-${itemId}`),
    ).toHaveCount(0);

    // A bad date is rejected the same way.
    await page
      .getByTestId(`review-deficiency-issue-${itemId}`)
      .fill("Faucet drips.");
    await page
      .getByTestId(`review-deficiency-date-${itemId}`)
      .fill("not-a-date");
    await page.getByTestId(`review-deficiency-save-${itemId}`).click();
    await expect(
      page.getByTestId(`review-deficiency-error-${itemId}`),
    ).toContainText(/YYYY-MM-DD/);
    await expect(
      page.getByTestId(`review-deficiency-display-${itemId}`),
    ).toHaveCount(0);

    // Valid input saves and announces the worker record.
    await page
      .getByTestId(`review-deficiency-date-${itemId}`)
      .fill("2026-11-04");
    await page.getByTestId(`review-deficiency-save-${itemId}`).click();
    await expect(
      page.getByTestId(`review-deficiency-display-${itemId}`),
    ).toContainText("Faucet drips.");

    // A replacement photo flags the finding for re-confirmation (alert, not color alone).
    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(pngFile("second.png"));
    await expect(
      page.getByTestId(`review-deficiency-stale-${itemId}`),
    ).toContainText(/photo changed/i);

    // Clearing removes the record and restores the empty state.
    await page.getByTestId(`review-deficiency-clear-${itemId}`).click();
    await expect(
      page.getByTestId(`review-deficiency-display-${itemId}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`review-deficiency-empty-${itemId}`),
    ).toBeVisible();
    const html = await downloadPacket(page);
    expect(html).toContain("No worker deficiencies recorded.");
    expect(html).not.toContain("Faucet drips.");
  });

  test("case notes validate length, announce status, and clear", async ({
    page,
  }) => {
    await page.goto("/");
    await resolveFirstItemId(page);

    // The draft section starts empty with worker-only guidance.
    await expect(page.getByTestId("case-notes-section")).toContainText(
      /never.*AI output|never.*filled in from AI/i,
    );
    await expect(page.getByTestId("case-notes-empty")).toBeVisible();

    // Empty notes are rejected with an announced error; nothing saves.
    await page.getByTestId("case-notes-edit").click();
    await page.getByTestId("case-notes-input").fill("   ");
    await page.getByTestId("case-notes-save").click();
    await expect(page.getByTestId("case-notes-error")).toContainText(
      /1–2000/,
    );
    await expect(page.getByTestId("case-notes-display")).toHaveCount(0);

    // Valid notes save, announce, and survive reload as local progress.
    await page
      .getByTestId("case-notes-input")
      .fill("Hallway dim; occupant will report outages.");
    await page.getByTestId("case-notes-save").click();
    await expect(page.getByTestId("case-notes-display")).toContainText(
      "Hallway dim; occupant will report outages.",
    );
    await page.reload();
    await expect(page.getByTestId("walkthrough-heading")).toBeVisible();
    await expect(page.getByTestId("case-notes-display")).toContainText(
      "Hallway dim; occupant will report outages.",
    );

    // Clearing restores the empty state and the packet names the absence.
    await page.getByTestId("case-notes-clear").click();
    await expect(page.getByTestId("case-notes-empty")).toBeVisible();
    const html = await downloadPacket(page);
    expect(html).toContain("No session case notes recorded.");
    expect(html).not.toContain("Hallway dim;");
  });

  test("packet keeps unresolved checks separate from worker findings", async ({
    page,
  }) => {
    await page.goto("/");
    const ids = await allItemIds(page);
    expect(ids.length).toBe(11);
    const itemId = ids[0];
    await uploadAndAwaitDraft(page, itemId);

    await recordFinding(page, itemId, {
      issue: "Window lock sticks halfway.",
      action: "Operate by hand with occupant; recheck closure.",
    });

    // Record one check as not-performed: it stays unresolved by design.
    await page.getByTestId(`review-accept-${itemId}`).click();
    const firstNote = page
      .locator(`[data-testid^="review-check-note-${itemId}-"]`)
      .first();
    const noteTestId =
      (await firstNote.getAttribute("data-testid")) as string;
    const checkId = noteTestId.replace(`review-check-note-${itemId}-`, "");
    await firstNote.fill("Tenant declined the run test.");
    await page
      .getByTestId(`review-check-notperformed-${itemId}-${checkId}`)
      .click();
    await expect(
      page.getByTestId(`review-check-${itemId}-${checkId}`),
    ).toContainText("not-performed");

    const html = await downloadPacket(page);
    // Both sections render with distinct headings and counts.
    expect(html).toContain("Worker deficiency list (1)");
    expect(html).toContain("Window lock sticks halfway.");
    expect(html).toContain("Unresolved required checks (");
    expect(html).toContain("not performed — unresolved");
    // The unresolved item exports the worker note but never the draft text.
    expect(html).toContain(
      "Missing evidence only — not worker findings",
    );
    expect(html).toContain("Worker-recorded notes only — never approved findings");
    // The packet still reads as a worker-review draft, never completed.
    expect(html).toContain("worker-review draft");
    expect(html).not.toContain("All required checks recorded as performed.");
  });
});
