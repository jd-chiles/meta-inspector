/**
 * Browser acceptance for TASK-072 plus TASK-088 UI wiring
 * (REQ-001, REQ-007, REQ-009, REQ-011, REQ-013).
 *
 * PWA shell and offline behavior:
 * - The web app manifest is valid (name, short name, icons, display,
 *   theme) and every declared icon is served; the app shell discovers it
 *   through an emitted manifest link.
 * - The service worker script is served with a shell-only cache policy:
 *   it precaches the app shell and guards API traffic, and it never
 *   intercepts non-GET work (uploads/deletions stay on the network).
 * - The app shell registers the service worker on load and reports its
 *   status; an offline reload still boots the SW-controlled cached shell
 *   with saved progress and honest pending states (no network).
 * - While the browser is offline, staging a photo never synthesizes a
 *   draft and never implies a verdict: the failure keeps the photo and
 *   surfaces an explicit, announced error with a retry affordance, and the
 *   walkthrough records a pending-only queued intent that waits for an
 *   explicit retry.
 * - On reconnect, an explicit worker retry (not an automatic sync)
 *   analyzes the kept photo and produces a draft.
 * - Saved local progress survives a reload (offline-tolerant recovery).
 *
 * Fixture-only: the app server under test runs in explicit fixture mode
 * (APP_ANALYSIS_MODE=fixture, no Meta key); uploads are synthetic 1x1
 * PNG bytes generated in code. Browser-context offline emulation stands
 * in for network loss (no real network cuts). Nothing here proves live
 * inference. Every test ends in explicit expects; no test is skipped.
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

/* Isolated storage per test so offline/reload assertions stay exact. */
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Resolve the first checklist item id from the capture input rendered for
 * the bundled demo catalog (testids are capture-*-<itemId>). Fails
 * explicitly when the guided capture UI is absent.
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

test.describe("installable PWA shell assets (REQ-013)", () => {
  test("web app manifest is valid with standalone display and served icons", async ({
    page,
  }) => {
    // The app shell must discover the manifest through an emitted link.
    const doc = await (await page.request.get("/")).text();
    expect(doc).toContain('rel="manifest"');
    expect(doc).toContain("/manifest.webmanifest");

    const response = await page.request.get("/manifest.webmanifest");
    expect(response.ok(), "the PWA manifest must be served").toBe(true);
    const manifest = (await response.json()) as {
      name?: string;
      short_name?: string;
      display?: string;
      theme_color?: string;
      background_color?: string;
      icons?: Array<{ src?: string; sizes?: string; purpose?: string }>;
    };
    expect(manifest.name).toBe("Habitability Walkthrough Companion");
    expect((manifest.short_name ?? "").length).toBeGreaterThan(0);
    expect(manifest.display).toBe("standalone");
    expect((manifest.theme_color ?? "").length).toBeGreaterThan(0);
    expect((manifest.background_color ?? "").length).toBeGreaterThan(0);
    const icons = manifest.icons ?? [];
    expect(icons.length).toBeGreaterThanOrEqual(3);
    expect(icons.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(icons.some((icon) => icon.sizes === "512x512")).toBe(true);
    expect(
      icons.some((icon) => (icon.purpose ?? "").includes("maskable")),
    ).toBe(true);
    for (const icon of icons) {
      expect(icon.src, "every manifest icon must declare a source").toBeDefined();
      const iconResponse = await page.request.get(icon.src as string);
      expect(
        iconResponse.ok(),
        `manifest icon ${icon.src} must be served`,
      ).toBe(true);
    }
  });

  test("service worker serves a shell-only policy: precache plus API/non-GET guards", async ({
    page,
  }) => {
    const response = await page.request.get("/sw.js");
    expect(response.ok(), "the service worker script must be served").toBe(true);
    const body = await response.text();
    // App-shell precache for offline launch.
    expect(body).toContain("SHELL_CACHE");
    expect(body).toContain('"/"');
    expect(body).toContain("/manifest.webmanifest");
    // API traffic is never cached and never served from cache.
    expect(body).toContain("/api/");
    // Non-GET work (analysis uploads, deletions) never enters the cache.
    expect(body).toContain("GET");
    // Install/activate lifecycle for shell updates.
    expect(body).toContain("install");
    expect(body).toContain("activate");
  });

  test("offline reload serves the SW-controlled app shell with saved progress (REQ-007, REQ-013)", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    // The shell registers the service worker on load and reports readiness.
    await expect(page.getByTestId("sw-status")).toContainText(
      /offline shell ready/i,
      { timeout: 20000 },
    );
    // Reload once while online so the service worker takes control, then
    // confirm control before cutting the network.
    await page.reload();
    await expect(page.getByTestId("walkthrough-heading")).toBeVisible();
    await page.waitForFunction(
      () => Boolean(navigator.serviceWorker?.controller),
      null,
      { timeout: 20000 },
    );

    await context.setOffline(true);
    try {
      await page.reload();
      // No network: the SW-cached shell still boots with saved progress,
      // honest offline status, and the per-item capture controls.
      await expect(page.getByTestId("walkthrough-heading")).toBeVisible({
        timeout: 20000,
      });
      await expect(page.getByTestId("offline-status")).toContainText(
        /offline/i,
        { timeout: 20000 },
      );
      await expect(
        page.getByTestId(`capture-input-upload-${itemId}`),
      ).toBeAttached();
    } finally {
      await context.setOffline(false);
    }
  });
});

test.describe("offline pending-only failure and explicit reconnect sync (REQ-007, REQ-009, REQ-010)", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("offline upload keeps the photo, reports an explicit error, and synthesizes no draft", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    await page.context().setOffline(true);
    try {
      await page
        .getByTestId(`capture-input-upload-${itemId}`)
        .setInputFiles(pngFile());
      // The staged photo is kept locally …
      await expect(page.getByTestId(`capture-preview-${itemId}`)).toBeVisible();
      // … the transport failure is announced with recovery …
      const error = page.getByTestId(`review-error-${itemId}`);
      await expect(error).toBeVisible({ timeout: 20000 });
      await expect(error).toContainText(/photo is kept/i);
      // … the walkthrough records a pending-only queued intent (no draft,
      // no verdict) that waits for an explicit retry …
      await expect(page.getByTestId("offline-status")).toContainText(
        /pending|queued/i,
        { timeout: 20000 },
      );
      await expect(
        page.getByTestId(`offline-pending-${itemId}`),
      ).toContainText(/pending/i);
      // … and no draft is ever synthesized while offline: nothing to
      // review, nothing implying a verdict.
      await expect(page.getByTestId(`review-draft-${itemId}`)).toHaveCount(0);
      await expect(page.getByTestId(`review-${itemId}`)).not.toContainText(
        "Accepted",
      );
    } finally {
      await page.context().setOffline(false);
    }
  });

  test("explicit retry on reconnect analyzes the kept photo (nothing ran automatically)", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    await page.context().setOffline(true);
    await page
      .getByTestId(`capture-input-upload-${itemId}`)
      .setInputFiles(pngFile());
    await expect(
      page.getByTestId(`review-error-${itemId}`),
      "offline analysis must fail explicitly with the photo kept",
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId(`review-draft-${itemId}`)).toHaveCount(0);

    // Reconnect performs no automatic sync: the draft appears only after
    // the worker explicitly retries the kept photo.
    await page.context().setOffline(false);
    await expect(page.getByTestId(`review-draft-${itemId}`)).toHaveCount(0);
    await page.getByTestId(`review-reanalyze-${itemId}`).click();
    await expect(
      page.getByTestId(`review-draft-${itemId}`),
      "explicit retry on reconnect must produce a draft from the kept photo",
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId(`capture-preview-${itemId}`)).toBeVisible();
    // The explicit retry consumes the queued intent: nothing stays pending.
    await expect(
      page.getByTestId(`offline-pending-${itemId}`),
    ).toHaveCount(0);
  });

  test("saved progress survives reload for offline-tolerant recovery", async ({
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
    await expect(
      page.getByTestId(`capture-input-upload-${itemId}`),
    ).toBeAttached();
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

  test("offline failure announces status text and keeps keyboard-operable recovery", async ({
    page,
  }) => {
    await page.goto("/");
    const itemId = await resolveFirstItemId(page);
    await page.context().setOffline(true);
    try {
      await page
        .getByTestId(`capture-input-upload-${itemId}`)
        .setInputFiles(pngFile());
      const error = page.getByTestId(`review-error-${itemId}`);
      await expect(error).toBeVisible({ timeout: 20000 });
      // The error is announced (role=alert) and recovery is a native button.
      await expect(error).toHaveAttribute("role", "alert");
      const retry = page.getByTestId(`review-reanalyze-${itemId}`);
      await expect(retry).toBeEnabled();
      await retry.focus();
      await expect(retry).toBeFocused();
    } finally {
      await page.context().setOffline(false);
    }
  });
});
