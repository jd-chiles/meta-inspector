/**
 * Browser integration for the client-only QuickTime-to-MP4 normalization path.
 * The input is a synthetic rights-free H.264 MOV made by packet-copy from the
 * repository's test-pattern MP4. The fixture server runs without Meta
 * credentials; this flow only uploads, normalizes, stores, and previews locally.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { goToCapture, openProfilePanel, selectRoom } from "./navigation";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 360, height: 800 },
  isMobile: true,
});

async function openCapture(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByTestId("analysis-mode")).toHaveText("Sample only");
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await openProfilePanel(page, "Unit & Funding");
  await page.getByLabel("Unit pseudonym").fill("Staged MOV Test Unit");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await goToCapture(page);
}

async function inspectSavedClip(page: Page): Promise<{
  fileName: string;
  mime: string;
  blobType: string;
  majorBrand: string;
  byteLength: number;
}> {
  return page.evaluate(async () => {
    const sessionId = localStorage.getItem("move-in-ready-active-session-v1");
    if (!sessionId) throw new Error("The active mock walkthrough session was missing.");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("move-in-ready-video-clips");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open local video storage."));
    });
    try {
      const row = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const request = db.transaction("clips", "readonly").objectStore("clips")
          .get(`${encodeURIComponent(sessionId)}::kitchen`);
        request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
        request.onerror = () => reject(request.error ?? new Error("Could not read the saved room clip."));
      });
      if (!row || !(row.video instanceof Blob)) throw new Error("The normalized clip was not saved as a local Blob.");
      const header = new Uint8Array(await row.video.slice(0, 12).arrayBuffer());
      const ascii = (start: number, end: number) => String.fromCharCode(...header.slice(start, end));
      if (ascii(4, 8) !== "ftyp") throw new Error("The saved clip does not have an MP4 file-type box.");
      return {
        fileName: String(row.fileName),
        mime: String(row.mime),
        blobType: row.video.type,
        majorBrand: ascii(8, 12),
        byteLength: row.video.size,
      };
    } finally {
      db.close();
    }
  });
}

async function decodeSavedPreview(page: Page): Promise<{ duration: number; readyState: number; currentTime: number }> {
  return page.getByLabel("Kitchen walkthrough clip preview").evaluate(async (element) => {
    if (!(element instanceof HTMLVideoElement)) throw new Error("The saved room clip preview was not a video element.");
    const video = element;
    if (!video.currentSrc.startsWith("blob:")) throw new Error("The saved clip preview is not using the local object URL.");
    const waitFor = (eventName: "loadeddata" | "seeked") => new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(() => reject(new Error(`Preview did not emit ${eventName}.`))), 10_000);
      const finish = (callback: () => void) => {
        window.clearTimeout(timeout);
        video.removeEventListener(eventName, onEvent);
        video.removeEventListener("error", onError);
        callback();
      };
      const onEvent = () => finish(resolve);
      const onError = () => finish(() => reject(new Error("The saved MP4 preview could not be decoded.")));
      video.addEventListener(eventName, onEvent, { once: true });
      video.addEventListener("error", onError, { once: true });
    });

    if (video.error) throw new Error("The saved MP4 preview could not be decoded.");
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitFor("loadeddata");
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("The saved MP4 has no playable duration.");
    video.currentTime = Math.min(0.5, video.duration / 2);
    await waitFor("seeked");
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitFor("loadeddata");
    return { duration: video.duration, readyState: video.readyState, currentTime: video.currentTime };
  });
}

test("a mobile MOV upload is normalized, saved locally as MP4, and decodes from its preview", async ({ page }) => {
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (/^\/api\/(?:video\/segment|analyze)(?:\/|$)/.test(pathname)) providerRequests.push(request.url());
  });

  await openCapture(page);
  const movBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mov"));
  const upload = page.getByLabel("Upload an MP4 or MOV room video");
  await upload.setInputFiles({
    name: "synthetic-h264-test-pattern.mov",
    mimeType: "video/quicktime",
    buffer: movBytes,
  });

  const savedNotice = page.getByText(/Clip saved on this device\./);
  const appError = page.locator("p[role=alert]");
  await expect.poll(async () => await savedNotice.isVisible() || await appError.isVisible(), { timeout: 30_000 })
    .toBe(true);
  if (await appError.isVisible()) {
    throw new Error(`MOV normalization failed: ${await appError.innerText()}`);
  }
  await expect(savedNotice).toBeVisible();
  await expect(page.getByText("synthetic-h264-test-pattern.mp4", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Kitchen walkthrough clip preview")).toBeVisible();
  await expect(page.getByRole("img", { name: /Source video frame at/ })).toHaveCount(0);
  const stillsDisclosure = page.getByTestId("source-stills-details");
  await expect(stillsDisclosure).toHaveJSProperty("open", false);

  const stored = await inspectSavedClip(page);
  expect(stored).toMatchObject({
    fileName: "synthetic-h264-test-pattern.mp4",
    mime: "video/mp4",
    blobType: "video/mp4",
  });
  expect(stored.majorBrand).not.toBe("qt  ");
  expect(stored.byteLength).toBeGreaterThan(0);

  await page.reload();
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await goToCapture(page);
  await selectRoom(page, "kitchen");
  await expect(page.getByText("synthetic-h264-test-pattern.mp4", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel("Kitchen walkthrough clip preview")).toBeVisible();
  const preview = await decodeSavedPreview(page);
  expect(preview.readyState).toBeGreaterThanOrEqual(2);
  expect(preview.duration).toBeGreaterThan(0);
  expect(preview.currentTime).toBeGreaterThan(0);

  expect(providerRequests, "local MOV normalization and preview must not call a provider route").toHaveLength(0);
});
