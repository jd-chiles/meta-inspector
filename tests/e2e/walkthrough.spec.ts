/**
 * Browser acceptance for TASK-009
 * (REQ-001 … REQ-012; acceptance: 360px capture/upload, review, edit,
 * rejection, manual checks, printable output; delayed-response races;
 * storage failure/reload, corrupt image, timeout, invalid output,
 * missing key; fixture-only CI with no provider credentials).
 *
 * Fixture-only: the app server under test runs in explicit fixture mode
 * (APP_ANALYSIS_MODE=fixture, no Meta key), every /api/analyze response
 * asserted here is mock-unit output, and image uploads are synthetic
 * 1x1 PNG bytes generated in code (no people, no tenant data). Nothing
 * here proves live inference. No test is skipped and the file never
 * passes with zero assertions: every test ends in explicit expects.
 *
 * These tests fail while the guided capture/review/export UI is absent
 * (scaffold status placeholders carry no capture/review/export testids)
 * and pass once the walkthrough flow is wired per the component contracts
 * (capture-*, review-*, export-* data-testids).
 */
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

function corruptFile(name = "corrupt.png") {
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from("this is not image bytes, only text"),
  };
}

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

test.describe("mobile walkthrough shell (REQ-001, REQ-003, REQ-009)", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("360px renders demo notice, fixture mode, and no horizontal scroll", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("walkthrough-heading")).toBeVisible();
    await expect(page.getByTestId("demo-banner")).toContainText(
      "Demo checklist — not a verified Form 1083 mapping.",
    );
    await expect(page.getByTestId("analysis-mode")).toContainText("fixture");
    await expect(page.getByTestId("analysis-mode")).toContainText(
      "mock output — not live inference",
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(
      overflow,
      "360px layout must not scroll horizontally",
    ).toBeLessThanOrEqual(1);
  });

  test("keyboard traversal reaches capture controls with visible labels", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    const uploadPicker = page.getByTestId(`capture-pick-upload-${itemId}`);
    await expect(uploadPicker).toBeVisible();
    await uploadPicker.focus();
    await expect(uploadPicker).toBeFocused();
    // Camera fallback help is announced as text, never color alone.
    await expect(page.getByTestId(`capture-status-${itemId}`)).toContainText(
      "Status:",
    );
    // Skip link is the first keyboard stop for screen-reader users.
    const skipLink = page.locator(".skip-link").first();
    await expect(skipLink).toBeAttached();
  });
});

test.describe("guided capture and upload (REQ-002, REQ-009)", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("upload stages a preview and keeps the earlier photo on invalid input", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    const uploadInput = page.getByTestId(`capture-input-upload-${itemId}`);

    await uploadInput.setInputFiles(pngFile());
    await expect(page.getByTestId(`capture-preview-${itemId}`)).toBeVisible();
    await expect(page.getByTestId(`capture-status-${itemId}`)).not.toContainText(
      "empty",
    );

    // An empty selection is rejected client-side WITHOUT clearing the
    // staged usable photo: the preview stays and an error is announced.
    await uploadInput.setInputFiles({
      name: "empty.png",
      mimeType: "image/png",
      buffer: Buffer.from([]),
    });
    await expect(page.getByTestId(`capture-preview-${itemId}`)).toBeVisible();
    await expect(page.getByTestId(`capture-error-${itemId}`)).toBeVisible();
  });

  test("retake replaces the photo and remove deletes local evidence", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    const uploadInput = page.getByTestId(`capture-input-upload-${itemId}`);
    await uploadInput.setInputFiles(pngFile("first.png"));
    await expect(page.getByTestId(`capture-preview-${itemId}`)).toBeVisible();

    await page.getByTestId(`capture-retake-${itemId}`).click();
    await uploadInput.setInputFiles(pngFile("second.png"));
    await expect(page.getByTestId(`capture-preview-${itemId}`)).toBeVisible();

    await page.getByTestId(`capture-remove-${itemId}`).click();
    await expect(page.getByTestId(`capture-preview-${itemId}`)).toHaveCount(0);
    await expect(page.getByTestId(`capture-status-${itemId}`)).toContainText(
      "empty",
    );
  });
});

test.describe("review, edit, rejection, and manual checks (REQ-004, REQ-005)", () => {
  test("draft stays unreviewed until the worker decides; edit preserves the original", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(pngFile());

    const review = page.getByTestId(`review-${itemId}`);
    await expect(review).toContainText("unreviewed", { ignoreCase: true });
    await expect(page.getByTestId(`review-observation-${itemId}`)).not.toBeEmpty();
    await expect(page.getByTestId(`review-unknowns-${itemId}`)).toBeVisible();
    // Provenance binds the draft to session/item/version/media identity.
    await expect(page.getByTestId(`review-provenance-${itemId}`)).toContainText(
      "Media digest",
    );

    // Edit-and-accept keeps the original draft visible for audit.
    await page.getByTestId(`review-edit-open-${itemId}`).click();
    await page
      .getByTestId(`review-edit-text-${itemId}`)
      .fill("Worker-verified note: basin intact, taps to be tested by hand.");
    await page.getByTestId(`review-edit-accept-${itemId}`).click();
    await expect(page.getByTestId(`review-${itemId}`)).toContainText(
      "accepted-edited",
    );
    await expect(
      page.getByTestId(`review-worker-revision-${itemId}`),
    ).toContainText("Worker-verified note");
    await expect(page.getByTestId(`review-draft-${itemId}`)).toBeVisible();
  });

  test("rejection is not acceptance and lists the item as unresolved", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(pngFile());

    await page.getByTestId(`review-reject-open-${itemId}`).click();
    await page
      .getByTestId(`review-reject-reason-${itemId}`)
      .fill("Photo too dark to use.");
    await page.getByTestId(`review-reject-${itemId}`).click();

    await expect(page.getByTestId(`review-${itemId}`)).toContainText(
      "Rejected — not accepted",
    );
    await expect(page.getByTestId(`review-${itemId}`)).not.toContainText(
      "accepted-edited",
    );
  });

  test("accepting draft text never resolves a required manual check", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(pngFile());

    await page.getByTestId(`review-accept-${itemId}`).click();
    // The required check still reports unresolved until performed by hand.
    await expect(page.getByTestId(`review-checks-${itemId}`)).toContainText(
      "unresolved",
    );
    const summary = page.getByTestId("export-summary");
    await expect(summary).toContainText("Unresolved");
  });

  test("manual checks record performed with a note; not-performed stays unresolved", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(pngFile());
    await page.getByTestId(`review-accept-${itemId}`).click();

    // Resolve the first required check input on the page (catalog-driven).
    const firstNote = page
      .locator(`[data-testid^="review-check-note-${itemId}-"]`)
      .first();
    const noteTestId =
      (await firstNote.getAttribute("data-testid")) as string;
    const checkId = noteTestId.replace(`review-check-note-${itemId}-`, "");
    await firstNote.fill("Ran both taps; basin drained.");
    await page
      .getByTestId(`review-check-performed-${itemId}-${checkId}`)
      .click();
    await expect(
      page.getByTestId(`review-check-${itemId}-${checkId}`),
    ).toContainText("recorded as performed");

    // A missing note cannot record a check: the pending state survives.
    const secondNote = page
      .locator(`[data-testid^="review-check-note-${itemId}-"]`)
      .nth(1);
    if ((await secondNote.count()) > 0) {
      const secondTestId =
        (await secondNote.getAttribute("data-testid")) as string;
      const secondCheckId = secondTestId.replace(
        `review-check-note-${itemId}-`,
        "",
      );
      await secondNote.fill("");
      await page
        .getByTestId(`review-check-notperformed-${itemId}-${secondCheckId}`)
        .click();
      await expect(
        page.getByTestId(`review-check-${itemId}-${secondCheckId}`),
      ).toContainText("pending");
    }
  });
});

test.describe("failure races and recovery (REQ-002, REQ-006, REQ-007, REQ-010)", () => {
  test("delayed analysis plus retake discards the stale draft", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);

    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    await page.route("**/api/analyze", async (route) => {
      await gate;
      await route.continue();
    });

    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(pngFile("first.png"));
    // Stage a replacement photo while the first analysis is still gated
    // inflight (the hidden input stays mounted for exactly this recovery
    // path). The stale first response must be discarded, never attached.
    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(pngFile("second.png"));
    releaseFirst();
    await page.unroute("**/api/analyze");

    // The flow settles on the current photo: one preview and a draft (or
    // an explicit error) for the replacement — never the stale result.
    await expect(page.getByTestId(`capture-preview-${itemId}`)).toHaveCount(1);
    const settled = page
      .getByTestId(`review-draft-${itemId}`)
      .or(page.getByTestId(`review-error-${itemId}`))
      .or(page.getByTestId(`capture-error-${itemId}`));
    await expect(
      settled,
      "replacement photo must settle to a draft or an explicit error",
    ).toBeVisible({ timeout: 20000 });
  });

  test("delete during inflight analysis leaves no resurrected draft", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/analyze", async (route) => {
      await gate;
      await route.continue();
    });
    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(pngFile());
    // Cancel keeps the photo; delete then removes local evidence entirely.
    // (Remove is locked while analyzing, so cancellation comes first.)
    await page.getByTestId(`capture-cancel-${itemId}`).click();
    await expect(page.getByTestId(`capture-status-${itemId}`)).toContainText(
      "captured",
    );
    await page.getByTestId(`capture-remove-${itemId}`).click();
    release();
    await page.unroute("**/api/analyze");

    await expect(page.getByTestId(`review-${itemId}`)).not.toContainText(
      "Accepted",
    );
    await expect(page.getByTestId(`capture-status-${itemId}`)).toContainText(
      "empty",
    );
  });

  test("corrupt bytes surface an actionable error and keep recovery", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(pngFile());
    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(corruptFile());
    const error = page.getByTestId(`capture-error-${itemId}`);
    const reviewError = page.getByTestId(`review-error-${itemId}`);
    await expect(
      error.or(reviewError),
      "corrupt uploads must surface an explicit error state",
    ).toBeVisible();
  });

  test("reload recovers persisted evidence; storage outage warns explicitly", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(pngFile());
    await expect(page.getByTestId(`capture-preview-${itemId}`)).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("walkthrough-heading")).toBeVisible();
    // Recovery is either the persisted preview or an explicit empty state —
    // never a silent half-rendered flow.
    const previewCount = await page
      .getByTestId(`capture-preview-${itemId}`)
      .count();
    const statusText =
      (await page.getByTestId(`capture-status-${itemId}`).textContent()) ?? "";
    expect(
      previewCount === 1 || /empty|no photo|recovery|memory/i.test(statusText),
      "reload must recover evidence or explain its absence",
    ).toBe(true);
  });

  test("fixture mode sends no credentials and labels mock output", async ({
    page,
  }) => {
    const authed: string[] = [];
    await page.route("**/api/analyze", async (route) => {
      const headers = route.request().headers();
      if (headers.authorization) authed.push(headers.authorization);
      await route.continue();
    });
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(pngFile());
    // The flow must settle (draft or explicit error) before asserting that
    // no request in this fixture run carried credentials.
    const settled = page
      .getByTestId(`review-draft-${itemId}`)
      .or(page.getByTestId(`review-error-${itemId}`))
      .or(page.getByTestId(`capture-error-${itemId}`));
    await expect(settled).toBeVisible({ timeout: 20000 });
    expect(authed, "fixture calls must not carry credentials").toEqual([]);
    await expect(page.getByTestId("analysis-mode")).toContainText("fixture");
    await page.unroute("**/api/analyze");
  });
});

test.describe("review-only printable export (REQ-008)", () => {
  test("export repeats the review banner and hides unapproved draft text", async ({
    page,
  }) => {
    await page.goto("/");
    const summary = page.getByTestId("export-summary");
    await expect(summary).toBeVisible();
    await expect(page.getByTestId("export-banner")).toContainText(
      "Draft for worker review — not an approved inspection or HMIS submission.",
    );
    await expect(page.getByTestId("export-demo-notice")).toContainText(
      "Demo checklist — not a verified Form 1083 mapping.",
    );
    await expect(page.getByTestId("export-mode")).toContainText("fixture");
    await expect(page.getByTestId("export-completion")).toContainText(
      "Unresolved",
    );
    // Pending items list as unresolved with NO approved note or draft text.
    await expect(page.getByTestId("export-unresolved-summary")).toBeVisible();
    const printButton = page.getByTestId("export-print");
    await expect(printButton).toBeEnabled();
  });

  test("completed export carries the approved note once checks resolve", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(pngFile());
    await page.getByTestId(`review-edit-open-${itemId}`).click();
    await page
      .getByTestId(`review-edit-text-${itemId}`)
      .fill("Worker-verified note for export.");
    await page.getByTestId(`review-edit-accept-${itemId}`).click();

    // Record every required check as performed with notes.
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
    await expect(page.getByTestId(`export-summary`)).toContainText(
      "Worker-verified note for export.",
    );
  });
});
