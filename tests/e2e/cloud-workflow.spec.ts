import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { expect, test } from "@playwright/test";

import { configureMockUnit, installCloudMocks } from "./cloud-mocks";

const LIVE_PORT = 3103;
const LIVE_URL = `http://127.0.0.1:${LIVE_PORT}`;
let liveServer: ChildProcess | null = null;
let liveServerOutput = "";

async function startLiveServer(): Promise<void> {
  liveServerOutput = "";
  liveServer = spawn(process.execPath, [path.join(process.cwd(), "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(LIVE_PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(LIVE_PORT), APP_ANALYSIS_MODE: "live", META_API_KEY: "e2e-sentinel-never-used-by-a-provider", BASETEN_API_KEY: "", MODEL_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  liveServer.stdout?.on("data", (chunk: Buffer) => { liveServerOutput = `${liveServerOutput}${chunk.toString()}`.slice(-3000); });
  liveServer.stderr?.on("data", (chunk: Buffer) => { liveServerOutput = `${liveServerOutput}${chunk.toString()}`.slice(-3000); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (liveServer.exitCode !== null) throw new Error(`Live-mode UI server exited early.\n${liveServerOutput}`);
    try {
      if ((await fetch(LIVE_URL)).ok) return;
    } catch { /* Next is still starting. */ }
    await delay(200);
  }
  throw new Error(`Live-mode UI server did not become ready.\n${liveServerOutput}`);
}

async function stopLiveServer(): Promise<void> {
  const current = liveServer;
  liveServer = null;
  if (!current || current.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => current.once("exit", () => resolve()));
  current.kill("SIGTERM");
  await Promise.race([exited, delay(5_000)]);
  if (current.exitCode === null) current.kill("SIGKILL");
}

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true });

test("fixture mode hides cloud upload and invents no result", async ({ page }) => {
  const cloud = await installCloudMocks(page);
  await configureMockUnit(page);
  const bytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "staged-fixture-cloud.mp4", mimeType: "video/mp4", buffer: bytes,
  });
  await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
  const savedClip = page.getByTestId("saved-clip-details");
  if (!(await savedClip.evaluate((element) => (element as HTMLDetailsElement).open))) await savedClip.locator(":scope > summary").click();
  const details = page.getByTestId("analysis-disclosure");
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await details.locator("summary").click();
  await expect(details).toContainText("Sample mode is active. This video flow will not invent a sample result");
  await expect(details.getByRole("button", { name: "Upload saved clip to cloud storage", exact: true })).toHaveCount(0);
  expect(cloud.requests.filter((request) => request === "POST /api/video/jobs")).toHaveLength(0);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Sign-Off", exact: true }).click();
  await expect(page.getByTestId("inspection-result")).toHaveText("Needs review");
  await expect(page.getByText(/no result recorded/)).toBeVisible();
});

test.describe("live cloud upload", () => {
  test.beforeAll(async () => startLiveServer());
  test.afterAll(async () => stopLiveServer());

  test("upload is manual, consent-gated, hash-verified, and replacement-safe", async ({ page }) => {
    const cloud = await installCloudMocks(page);
    await configureMockUnit(page, "Meta live · untested", LIVE_URL);

    const bytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
    const replacementBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mov"));
    const capture = page.getByTestId("walkthrough-video-capture");
    await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
      name: "staged-kitchen-first.mp4", mimeType: "video/mp4", buffer: bytes,
    });
    // Local-first: the clip saves on this device and nothing uploads by itself.
    await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
    expect(cloud.requests.filter((request) => request === "POST /api/video/jobs")).toHaveLength(0);

    const savedClip = page.getByTestId("saved-clip-details");
    if (!(await savedClip.evaluate((element) => (element as HTMLDetailsElement).open))) await savedClip.locator(":scope > summary").click();
    const details = page.getByTestId("analysis-disclosure");
    if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await details.locator("summary").click();
    const trigger = details.getByRole("button", { name: "Upload saved clip to cloud storage", exact: true });
    await expect(trigger).toBeVisible();
    await expect(trigger).toBeDisabled();
    await details.getByRole("checkbox", { name: /I attest this is staged\/mock-unit footage/ }).check();
    await details.getByRole("checkbox", { name: /I understand this selected mock-unit video/ }).check();
    await expect(trigger).toBeEnabled();

    await trigger.click();
    await expect(details.getByText(/uploaded to cloud storage as job mock-job-1\. Storage only: no analysis ran/)).toBeVisible({ timeout: 30_000 });
    expect(cloud.requests.filter((request) => request === "POST /api/video/jobs")).toHaveLength(1);
    expect(cloud.requests).toContain("PUT /r2/video");
    expect(cloud.requests.indexOf("PUT /r2/video")).toBeGreaterThan(cloud.requests.findIndex((request) => request.startsWith("PUT /api/inspections/")));
    expect(cloud.requests.some((request) => request.endsWith("/process"))).toBe(false);

    const job = cloud.jobs.get("mock-job-1")!;
    expect(job.room).toBe("kitchen");
    expect(job.identity).toMatchObject({
      sessionId: expect.any(String),
      schemaVersion: expect.any(Number),
      videoId: expect.any(String),
      videoRevision: expect.any(Number),
      analysisId: expect.any(String),
      attempt: 1,
      catalogVersion: expect.any(String),
      expectedVideoSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const inspection = [...cloud.inspections.values()][0]!;
    const kitchen = (inspection.clipIdentities as Record<string, Record<string, unknown>>).kitchen;
    expect(kitchen.videoHash).toBe(job.identity.expectedVideoSha256);
    expect(JSON.stringify(inspection)).not.toContain("staged-kitchen-first.mp4");
    expect(JSON.stringify(inspection)).not.toContain("base64");

    // Replacing the clip clears the stale success; a fresh upload makes a new job.
    await capture.getByRole("button", { name: "Replace clip", exact: true }).click();
    await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
      name: "staged-kitchen-replacement.mov", mimeType: "video/quicktime", buffer: replacementBytes,
    });
    await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
    await expect(details.getByText(/uploaded to cloud storage as job/)).toHaveCount(0);
    if (!(await savedClip.evaluate((element) => (element as HTMLDetailsElement).open))) await savedClip.locator(":scope > summary").click();
    if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await details.locator("summary").click();
    const mockUnitConsent = details.getByRole("checkbox", { name: /I attest this is staged\/mock-unit footage/ });
    const providerConsent = details.getByRole("checkbox", { name: /I understand this selected mock-unit video/ });
    if (!(await mockUnitConsent.isChecked())) await mockUnitConsent.check();
    if (!(await providerConsent.isChecked())) await providerConsent.check();
    await expect(trigger).toBeEnabled();
    await trigger.click();
    await expect(details.getByText(/uploaded to cloud storage as job mock-job-2\. Storage only: no analysis ran/)).toBeVisible({ timeout: 30_000 });
    const job2 = cloud.jobs.get("mock-job-2")!;
    expect(job2.identity.expectedVideoSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(job2.identity.expectedVideoSha256).not.toBe(job.identity.expectedVideoSha256);
    expect(job2.identity.videoId).not.toBe(job.identity.videoId);
    const replaced = [...cloud.inspections.values()][0]!;
    const replacedKitchen = (replaced.clipIdentities as Record<string, Record<string, unknown>>).kitchen;
    expect(replacedKitchen.videoHash).toBe(job2.identity.expectedVideoSha256);
  });
});
