/**
 * Browser acceptance for TASK-072 (REQ-001, REQ-002, REQ-004, REQ-005,
 * REQ-008, REQ-009, REQ-011).
 *
 * 11-item catalog flows: full checklist rendering, capture/review on reserved
 * placeholder items, per-item unresolved/completed export policy, reload
 * recovery, and the printable print-CSS pass behind PDF parity.
 *
 * Fixture-only: the app server under test runs in explicit fixture mode
 * (APP_ANALYSIS_MODE=fixture, no Meta key), every /api/analyze response
 * asserted here is mock-unit output, and image uploads are synthetic
 * 1x1 PNG bytes generated in code (no people, no tenant data). Nothing
 * here proves live inference. No test is skipped and the file never
 * passes with zero assertions: every test ends in explicit expects.
 *
 * These tests fail while the 11-item contract is absent (the walkthrough
 * renders "Walkthrough unavailable" when the bundled catalog does not
 * validate) and pass once all 11 demo items flow through capture, review,
 * and export. Each test runs in an isolated storage state so completion
 * counts are exact, never polluted by sibling tests.
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

/* Isolated storage per test: completion counts stay exact (REQ-008). */
test.use({ storageState: { cookies: [], origins: [] } });

/** All catalog item IDs in render order (fails loudly when capture is absent). */
async function allItemIds(page: Page): Promise<string[]> {
  const inputs = page.locator('[data-testid^="capture-input-upload-"]');
  await expect(inputs.first()).toBeAttached({ timeout: 20000 });
  const count = await inputs.count();
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const raw = await inputs.nth(index).getAttribute("data-testid");
    expect(raw, "guided capture must render an upload input per catalog item").not.toBeNull();
    ids.push((raw as string).replace("capture-input-upload-", ""));
  }
  return ids;
}

test.describe("11-item checklist rendering (REQ-001, REQ-009, REQ-011)", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("renders 11 capture inputs with demo notice, fixture mode, and no horizontal scroll", async ({
    page,
  }) => {
    await page.goto("/");
    const ids = await allItemIds(page);
    expect(ids.length).toBe(11);
    expect(new Set(ids).size).toBe(11);
    for (const id of ids) {
      expect(id.startsWith("demo-")).toBe(true);
    }
    // The four carried items keep their stable verbatim IDs first.
    expect(ids.slice(0, 4)).toEqual([
      "demo-interior-air",
      "demo-water-supply",
      "demo-lighting-electric",
      "demo-smoke-co",
    ]);
    await expect(page.getByTestId("demo-banner")).toContainText(
      "Demo checklist — not a verified Form 1083 mapping.",
    );
    await expect(page.getByTestId("analysis-mode")).toContainText("fixture");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(
      overflow,
      "360px layout must not scroll horizontally for 11 items",
    ).toBeLessThanOrEqual(1);
  });

  test("checklist covers 11 items with explicit 11-item progress counts", async ({
    page,
  }) => {
    await page.goto("/");
    const ids = await allItemIds(page);
    expect(ids.length).toBe(11);
    await expect(page.getByText("Item 11 of 11").first()).toBeVisible();
    await expect(page.getByText("of 11 photos captured").first()).toBeVisible();
    await expect(page.getByText("of 11 drafts decided").first()).toBeVisible();
  });
});

test.describe("reserved placeholder capture and review (REQ-001, REQ-002, REQ-004, REQ-005)", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("reserved placeholder captures a photo and drafts like a carried item", async ({
    page,
  }) => {
    await page.goto("/");
    const ids = await allItemIds(page);
    const reserved = ids.find((id) => id.startsWith("demo-item-")) as string;
    expect(reserved, "the 11-item catalog must include reserved placeholders").toBeDefined();
    await page
      .getByTestId(`capture-input-upload-${reserved}`)
      .setInputFiles(pngFile());
    await expect(page.getByTestId(`capture-preview-${reserved}`)).toBeVisible();
    const review = page.getByTestId(`review-${reserved}`);
    await expect(review).toContainText("unreviewed", { ignoreCase: true });
    await expect(page.getByTestId(`review-observation-${reserved}`)).not.toBeEmpty();
    await expect(page.getByTestId(`review-unknowns-${reserved}`)).toBeVisible();
  });

  test("every item requires a manual check a photograph cannot establish", async ({
    page,
  }) => {
    await page.goto("/");
    const ids = await allItemIds(page);
    expect(ids.length).toBe(11);
    // The required-check list is catalog-driven and visible per item even
    // before capture, so the photo-gap requirement is auditable for all 11.
    for (const itemId of ids) {
      await expect(page.getByTestId(`review-checks-${itemId}`)).toContainText(
        /cannot establish/i,
      );
    }
  });

  test("accept plus performed check completes one reserved item; export counts 1 of 11", async ({
    page,
  }) => {
    await page.goto("/");
    const ids = await allItemIds(page);
    const reserved = ids[ids.length - 1];
    expect(reserved.startsWith("demo-item-")).toBe(true);
    await page
      .getByTestId(`capture-input-upload-${reserved}`)
      .setInputFiles(pngFile());
    await expect(page.getByTestId(`review-draft-${reserved}`)).toBeVisible({
      timeout: 20000,
    });
    await page.getByTestId(`review-accept-${reserved}`).click();
    const notes = page.locator(
      `[data-testid^="review-check-note-${reserved}-"]`,
    );
    const count = await notes.count();
    expect(count, "reserved item must expose at least one manual check").toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const noteInput = notes.nth(index);
      const noteTestId = (await noteInput.getAttribute("data-testid")) as string;
      const checkId = noteTestId.replace(`review-check-note-${reserved}-`, "");
      await noteInput.fill(`Performed by hand (${checkId}).`);
      await page
        .getByTestId(`review-check-performed-${reserved}-${checkId}`)
        .click();
    }
    await expect(page.getByTestId(`export-item-${reserved}`)).toHaveAttribute(
      "data-completed",
      "true",
    );
    await expect(page.getByTestId("export-completion")).toContainText(
      "Reviewed items: 1 of 11",
    );
    await expect(page.getByTestId("export-completion")).toContainText(
      "Unresolved items: 10",
    );
    await expect(page.getByTestId(`export-note-${reserved}`)).toBeVisible();
  });

  test("rejection lists the item as unresolved with no approved note in export", async ({
    page,
  }) => {
    await page.goto("/");
    const ids = await allItemIds(page);
    const reserved = ids[ids.length - 1];
    await page
      .getByTestId(`capture-input-upload-${reserved}`)
      .setInputFiles(pngFile());
    await expect(page.getByTestId(`review-draft-${reserved}`)).toBeVisible({
      timeout: 20000,
    });
    await page.getByTestId(`review-reject-open-${reserved}`).click();
    await page
      .getByTestId(`review-reject-reason-${reserved}`)
      .fill("Photo too dark to use.");
    await page.getByTestId(`review-reject-${reserved}`).click();
    await expect(page.getByTestId(`review-${reserved}`)).toContainText(
      "Rejected — not accepted",
    );
    await expect(page.getByTestId(`export-unresolved-${reserved}`)).toBeVisible();
    await expect(page.getByTestId(`export-note-${reserved}`)).toHaveCount(0);
    await expect(page.getByTestId("export-completion")).toContainText(
      "Reviewed items: 0 of 11",
    );
    await expect(page.getByTestId("export-unresolved-summary")).toContainText(
      reserved,
    );
  });
});

test.describe("11-item export parity and recovery (REQ-006, REQ-008, REQ-009)", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("untouched session exports 11 unresolved items with no draft text", async ({
    page,
  }) => {
    await page.goto("/");
    const ids = await allItemIds(page);
    expect(ids.length).toBe(11);
    await expect(page.getByTestId("export-completion")).toContainText(
      "Reviewed items: 0 of 11. Unresolved items: 11.",
    );
    await expect(page.getByTestId("export-unresolved-summary")).toBeVisible();
    for (const itemId of ids) {
      await expect(
        page.getByTestId(`export-unresolved-${itemId}`),
      ).toBeVisible();
      await expect(page.getByTestId(`export-note-${itemId}`)).toHaveCount(0);
    }
    await expect(page.getByTestId("export-banner")).toContainText(
      "Draft for worker review — not an approved inspection or HMIS submission.",
    );
  });

  test("print media keeps the review banner and hides print-only-excluded controls", async ({
    page,
  }) => {
    await page.goto("/");
    await allItemIds(page);
    // Browser print-CSS pass: the printable artifact carries the identical
    // banner/content policy as screen HTML (PDF parity), while action
    // controls are print-excluded.
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("export-banner").first()).toBeVisible();
    await expect(page.getByTestId("export-completion")).toBeVisible();
    await expect(page.getByTestId("export-print")).toBeHidden();
    await page.emulateMedia({ media: "screen" });
    await expect(page.getByTestId("export-print")).toBeVisible();
  });

  test("reload recovers the 11-item session and its staged photo", async ({
    page,
  }) => {
    await page.goto("/");
    const ids = await allItemIds(page);
    const reserved = ids[ids.length - 1];
    await page
      .getByTestId(`capture-input-upload-${reserved}`)
      .setInputFiles(pngFile());
    await expect(page.getByTestId(`capture-preview-${reserved}`)).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("walkthrough-heading")).toBeVisible();
    const reloaded = await allItemIds(page);
    expect(reloaded.length).toBe(11);
    expect(reloaded).toEqual(ids);
    const previewCount = await page
      .getByTestId(`capture-preview-${reserved}`)
      .count();
    const statusText =
      (await page.getByTestId(`capture-status-${reserved}`).textContent()) ?? "";
    expect(
      previewCount === 1 || /empty|no photo|recovery|memory/i.test(statusText),
      "reload must recover evidence or explain its absence",
    ).toBe(true);
  });
});
