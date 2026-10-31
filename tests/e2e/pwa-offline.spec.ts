import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { goToCapture, openProfilePanel } from "./navigation";

const APP_SHELL_CACHE = "habitability-walkthrough-shell-v2";

test.use({
  serviceWorkers: "allow",
  storageState: { cookies: [], origins: [] },
  viewport: { width: 360, height: 800 },
});

async function readSavedProgress(page: Page): Promise<{
  pseudonym: string;
  fundingType: string;
  selectedRoomId: string;
  capturedKitchenPromptCount: number;
} | null> {
  return page.evaluate(async () => {
    const sessionId = window.localStorage.getItem("move-in-ready-active-session-v1");
    if (!sessionId) throw new Error("The active walkthrough session was not saved locally.");

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("move-in-ready-inspections");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open local inspection storage."));
    });

    try {
      const row = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const request = db.transaction("inspections", "readonly").objectStore("inspections").get(sessionId);
        request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
        request.onerror = () => reject(request.error ?? new Error("Could not read local inspection storage."));
      });
      if (!row) return null;
      const prompts = row.completedPromptIdsByRoom as Record<string, unknown> | undefined;
      const kitchenPrompts = prompts?.kitchen;
      return {
        pseudonym: String(row.pseudonym ?? ""),
        fundingType: String(row.fundingType ?? ""),
        selectedRoomId: String(row.selectedRoomId ?? ""),
        capturedKitchenPromptCount: Array.isArray(kitchenPrompts) ? kitchenPrompts.length : 0,
      };
    } finally {
      db.close();
    }
  });
}

async function readCachedShellState(page: Page): Promise<{
  hasShell: boolean;
  hasManifest: boolean;
  staticResourceCount: number;
  missingStaticResources: string[];
}> {
  return page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    const hasShell = Boolean(await cache.match(new URL("/", location.origin).href));
    const hasManifest = Boolean(await cache.match(new URL("/manifest.webmanifest", location.origin).href));
    const staticUrls = [...new Set(performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => {
        try {
          const url = new URL(name);
          return url.origin === location.origin && url.pathname.startsWith("/_next/static/");
        } catch {
          return false;
        }
      }))];
    const missingStaticResources: string[] = [];
    for (const url of staticUrls) {
      if (!await cache.match(url)) missingStaticResources.push(url);
    }
    return { hasShell, hasManifest, staticResourceCount: staticUrls.length, missingStaticResources };
  }, APP_SHELL_CACHE);
}

test("the hydrated walkthrough saves and restores real local progress offline", async ({ page }) => {
  test.setTimeout(120_000);
  const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));

  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15_000 }).toBe(true);

  // Reload once under service-worker control so the real production JS/CSS
  // requests pass through its runtime cache before going offline.
  const controlledReload = await page.reload({ waitUntil: "domcontentloaded" });
  expect(controlledReload?.ok()).toBe(true);
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect.poll(async () => (await readCachedShellState(page)).missingStaticResources.length, { timeout: 20_000 }).toBe(0);

  const cachedState = await readCachedShellState(page);
  expect(cachedState.hasShell).toBe(true);
  expect(cachedState.hasManifest).toBe(true);
  expect(cachedState.staticResourceCount).toBeGreaterThan(0);
  expect(cachedState.missingStaticResources).toEqual([]);

  await page.context().setOffline(true);
  await expect(page.getByText("Offline. Capture and review stay on this device; live analysis needs a connection.", { exact: true })).toBeVisible();

  // Exercise the interactive app, its local video store, and its inspection
  // record while disconnected. The bundled file is a synthetic test pattern.
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await openProfilePanel(page, "Unit & Funding");
  await page.getByLabel("Unit pseudonym").fill("Offline Saved Unit 04");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await expect(page.getByText("Offline. Capture and review stay on this device; live analysis needs a connection.", { exact: true })).toBeVisible();
  await expect.poll(() => readSavedProgress(page)).toMatchObject({
    pseudonym: "Offline Saved Unit 04",
    fundingType: "lahsa",
  });

  await goToCapture(page);
  const canDecodeH264 = await page.evaluate(async () => {
    const nativeCanDecode = document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"') !== "";
    if (typeof VideoDecoder === "undefined") return nativeCanDecode;
    try {
      const support = await VideoDecoder.isConfigSupported({ codec: "avc1.42E01E", codedWidth: 320, codedHeight: 180 });
      return nativeCanDecode || support.supported === true;
    } catch {
      return nativeCanDecode;
    }
  });
  expect(canDecodeH264, "this offline acceptance uses the bundled synthetic MP4 in Chromium").toBe(true);
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "offline-kitchen-test-pattern.mp4",
    mimeType: "video/mp4",
    buffer: videoBytes,
  });
  await expect(page.getByText("Clip saved on this device. Review stills are frames from the video at the timestamps shown.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Mark filmed: Film one continuous take/, exact: false }).click();
  await expect(page.getByText("Filmed", { exact: true }).first()).toBeVisible();
  await expect.poll(() => readSavedProgress(page)).toMatchObject({
    pseudonym: "Offline Saved Unit 04",
    fundingType: "lahsa",
    selectedRoomId: "kitchen",
    capturedKitchenPromptCount: 1,
  });

  // API requests remain network-only while shell resources are cacheable.
  const offlineApiResult = await page.evaluate(async () => {
    const url = new URL("/api/video/segment?stage=segment", location.origin).href;
    const cached = Boolean(await caches.match(url));
    try {
      const response = await fetch(url, { method: "GET" });
      return { cached, outcome: "response", status: response.status };
    } catch {
      return { cached, outcome: "network-error", status: null };
    }
  });
  expect(offlineApiResult.cached).toBe(false);
  expect(offlineApiResult.outcome).toBe("network-error");

  const offlineReload = await page.reload({ waitUntil: "domcontentloaded" });
  expect(offlineReload?.status()).toBe(200);
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Video Capture" })).toBeVisible();
  await expect(page.getByText("Offline. Capture and review stay on this device; live analysis needs a connection.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove clip", exact: true })).toBeVisible();
  await expect(page.getByText("Filmed", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page.getByLabel("Unit pseudonym")).toHaveValue("Offline Saved Unit 04");
  await expect(page.getByLabel("Funding type")).toHaveValue("lahsa");
  await expect.poll(() => readSavedProgress(page)).toMatchObject({
    pseudonym: "Offline Saved Unit 04",
    fundingType: "lahsa",
    selectedRoomId: "kitchen",
    capturedKitchenPromptCount: 1,
  });
});
