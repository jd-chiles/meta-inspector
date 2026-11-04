import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { expect, test } from "@playwright/test";

import { configureMockUnit, installCloudMocks } from "./cloud-mocks";
import { selectRoom } from "./navigation";

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

test("upload is consent-gated, cloud-backed, reloadable, and replacement-safe", async ({ page }) => {
  const cloud = await installCloudMocks(page);
  const dialogMessages: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });
  await configureMockUnit(page);

  const bytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  const replacementBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mov"));
  const capture = page.getByTestId("walkthrough-video-capture");
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "staged-kitchen-first.mp4", mimeType: "video/mp4", buffer: bytes,
  });
  await expect(page.getByText(/Video uploaded securely to cloud storage\./)).toBeVisible({ timeout: 30_000 });
  expect(dialogMessages).toHaveLength(1);
  expect(dialogMessages[0]).toContain("private cloud storage");
  expect(dialogMessages[0]).toContain("will not be sent to AI until you separately approve processing");
  expect(cloud.requests.filter((request) => request === "POST /api/video/jobs")).toHaveLength(1);
  expect(cloud.requests.indexOf("PUT /r2/video")).toBeGreaterThan(cloud.requests.findIndex((request) => request.startsWith("PUT /api/inspections/")));

  const inspection = [...cloud.inspections.values()][0]!;
  const kitchen = (inspection.clipIdentities as Record<string, Record<string, unknown>>).kitchen;
  expect(kitchen).toMatchObject({ jobId: "mock-job-1", videoRevision: 1 });
  expect(kitchen.videoHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(inspection)).not.toContain("staged-kitchen-first.mp4");
  expect(JSON.stringify(inspection)).not.toContain("base64");

  const browserState = await page.evaluate(async () => ({
    knownLocalDbNames: (await indexedDB.databases()).map((database) => database.name)
      .filter((name) => name === "move-in-ready-inspections" || name === "move-in-ready-video-clips"),
    localStorageValues: Object.values(localStorage),
  }));
  expect(browserState.knownLocalDbNames).toEqual([]);
  expect(browserState.localStorageValues.join(" ")).not.toContain("staged-kitchen-first.mp4");
  expect(browserState.localStorageValues.join(" ")).not.toContain(bytes.toString("base64").slice(0, 80));

  await page.reload();
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Guide", exact: true }).click();
  const guide = page.getByTestId("assistant-guide");
  const toggle = guide.getByTestId("assistant-guide-toggle");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await guide.locator("button[class*='primaryButton']").first().click();
  const closeGuide = page.getByRole("button", { name: "Close the AI inspection guide", exact: true });
  if (await closeGuide.isVisible()) await closeGuide.click();
  await expect(page.getByRole("heading", { level: 1, name: "Film the unit" })).toBeVisible();
  await selectRoom(page, "kitchen");
  await expect(page.getByTestId("saved-clip-details")).toContainText("Cloud video & analysis");
  await expect(page.getByLabel("Kitchen walkthrough clip preview")).toBeVisible();
  expect(cloud.requests).toContain("GET /api/video/jobs/mock-job-1");

  await capture.getByRole("button", { name: "Replace clip", exact: true }).click();
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "staged-kitchen-replacement.mov", mimeType: "video/quicktime", buffer: replacementBytes,
  });
  await expect(page.getByText(/Video uploaded securely to cloud storage\./)).toBeVisible({ timeout: 30_000 });
  const replaced = [...cloud.inspections.values()][0]!;
  const replacedKitchen = (replaced.clipIdentities as Record<string, Record<string, unknown>>).kitchen;
  expect(replacedKitchen).toMatchObject({ jobId: "mock-job-2", videoRevision: 2 });
  expect(replacedKitchen.videoId).not.toBe(kitchen.videoId);
  expect(replacedKitchen.videoHash).not.toBe(kitchen.videoHash);
  await expect.poll(() => cloud.requests).toContain("DELETE /api/video/jobs/mock-job-1");
});

test("fixture mode cannot submit processing and does not substitute a sample result", async ({ page }) => {
  const cloud = await installCloudMocks(page);
  page.on("dialog", (dialog) => void dialog.accept());
  await configureMockUnit(page);
  const bytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "staged-consent-test.mp4", mimeType: "video/mp4", buffer: bytes,
  });
  await expect(page.getByText(/Video uploaded securely to cloud storage\./)).toBeVisible({ timeout: 30_000 });
  const savedClip = page.getByTestId("saved-clip-details");
  if (!(await savedClip.evaluate((element) => (element as HTMLDetailsElement).open))) await savedClip.locator(":scope > summary").click();
  const details = page.getByTestId("analysis-disclosure");
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await details.locator("summary").click();
  await expect(details).toContainText("Sample mode is active. This video flow will not invent a sample result");
  await expect(details.getByRole("button", { name: "Approve & process this room", exact: true })).toBeDisabled();
  await details.getByRole("checkbox", { name: /I attest this is staged\/mock-unit footage/ }).check();
  await details.getByRole("checkbox", { name: /I understand this selected mock-unit video and sampled stills/ }).check();
  await expect(details.getByRole("button", { name: "Approve & process this room", exact: true })).toBeDisabled();
  expect(cloud.requests.some((request) => request.endsWith("/process"))).toBe(false);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Sign-Off", exact: true }).click();
  await expect(page.getByTestId("inspection-result")).toHaveText("Needs review");
  await expect(page.getByText(/no result recorded/)).toBeVisible();
});

test.describe("live cloud cancellation", () => {
  test.beforeAll(async () => startLiveServer());
  test.afterAll(async () => stopLiveServer());

  test("keeps processing disabled until cancellation is confirmed", async ({ page }) => {
    const cloud = await installCloudMocks(page);
    page.on("dialog", (dialog) => void dialog.accept());
    await configureMockUnit(page, "Meta live · untested", LIVE_URL);
    const bytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
    await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({ name: "staged-cancel-race.mp4", mimeType: "video/mp4", buffer: bytes });
    await expect(page.getByText(/Video uploaded securely to cloud storage\./)).toBeVisible({ timeout: 30_000 });
    const savedClip = page.getByTestId("saved-clip-details");
    if (!(await savedClip.evaluate((element) => (element as HTMLDetailsElement).open))) await savedClip.locator(":scope > summary").click();
    const details = page.getByTestId("analysis-disclosure");
    if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await details.locator("summary").click();
    await details.getByRole("checkbox", { name: /I attest this is staged\/mock-unit footage/ }).check();
    await details.getByRole("checkbox", { name: /I understand this selected mock-unit video and sampled stills/ }).check();

    let releaseDelete!: () => void;
    let signalDeleteRequested!: () => void;
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
    const deleteRequested = new Promise<void>((resolve) => { signalDeleteRequested = resolve; });
    await page.route("**/api/video/jobs/mock-job-1", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      signalDeleteRequested();
      await deleteGate;
      await route.fulfill({ status: 200, json: { ok: true, jobId: "mock-job-1", status: "deleted", cleanupPending: false } });
    });

    const analyze = details.getByRole("button", { name: "Approve & process this room", exact: true });
    await analyze.click();
    await expect(details.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    const cancel = details.getByRole("button", { name: "Cancel", exact: true });
    const pollOrProcess = (entry: string) => entry.includes("/api/video/jobs/mock-job-1") && (entry.includes("GET") || entry.includes("process"));
    const priorPollOrProcess = cloud.requests.filter(pollOrProcess);
    await cancel.click();
    await deleteRequested;
    await expect(details.getByText("Confirming cloud cancellation. This job cannot be restarted until the cancellation result is known.", { exact: true })).toBeVisible();
    await expect(analyze).toBeDisabled();
    expect(cloud.requests.filter(pollOrProcess)).toEqual(priorPollOrProcess);

    releaseDelete();
    await expect(page.getByText("The cloud job was cancelled and deleted. Upload the saved video as a new attempt to continue.", { exact: true })).toBeVisible();
    await expect(details.getByRole("button", { name: "Upload saved video as a new attempt", exact: true })).toBeEnabled();
  });
});
