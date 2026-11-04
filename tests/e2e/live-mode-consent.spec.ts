import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { expect, test } from "@playwright/test";

import { installCloudMocks } from "./cloud-mocks";

const PORT = 3102;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server: ChildProcess | null = null;
let serverOutput = "";

async function startLiveUiServer(): Promise<void> {
  serverOutput = "";
  server = spawn(process.execPath, [path.join(process.cwd(), "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      APP_ANALYSIS_MODE: "live",
      // A sentinel only: all app/job requests are intercepted in the browser.
      META_API_KEY: "e2e-sentinel-never-used-by-a-provider",
      BASETEN_API_KEY: "",
      MODEL_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-3000); });
  server.stderr?.on("data", (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-3000); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Live-mode UI server exited early.\n${serverOutput}`);
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch { /* Next is still starting. */ }
    await delay(200);
  }
  throw new Error(`Live-mode UI server did not become ready.\n${serverOutput}`);
}

async function stopLiveUiServer(): Promise<void> {
  const current = server;
  server = null;
  if (!current || current.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => current.once("exit", () => resolve()));
  current.kill("SIGTERM");
  await Promise.race([exited, delay(5_000)]);
  if (current.exitCode === null) current.kill("SIGKILL");
}

test.beforeAll(async () => startLiveUiServer());
test.afterAll(async () => stopLiveUiServer());
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true });

test("live processing needs fresh separate consent and sends one explicit identity-bound process request", async ({ page }) => {
  const cloud = await installCloudMocks(page);
  const processRequests: Array<{ jobId: string; identity: Record<string, unknown> }> = [];
  await page.route("**/api/video/jobs/*/process", async (route) => {
    const request = route.request();
    const jobId = new URL(request.url()).pathname.split("/").at(-2)!;
    const body = request.postDataJSON() as { identity: Record<string, unknown> };
    processRequests.push({ jobId, identity: body.identity });
    await route.fulfill({
      json: {
        ok: true, jobId, status: "ambiguous", identity: body.identity,
        error: { code: "MOCK_TERMINAL", message: "Mock job stopped before any provider was called." },
      },
    });
  });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(BASE_URL);
  await expect(page.getByTestId("analysis-mode")).toHaveText("Meta live · untested");
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  const unitFunding = page.getByRole("button", { name: "Unit & Funding", exact: true });
  if (await unitFunding.getAttribute("aria-expanded") !== "true") await unitFunding.click();
  await page.getByLabel("Unit pseudonym").fill("Staged Cloud Test Unit 04");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await page.getByLabel("Unit type").selectOption("studio");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Guide", exact: true }).click();
  const guide = page.getByTestId("assistant-guide");
  const toggle = guide.getByTestId("assistant-guide-toggle");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await guide.locator("button[class*='primaryButton']").first().click();
  const closeGuide = page.getByRole("button", { name: "Close the AI inspection guide", exact: true });
  if (await closeGuide.isVisible()) await closeGuide.click();
  await expect(page.getByRole("heading", { level: 1, name: "Film the unit" })).toBeVisible();

  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "staged-live-consent.mp4", mimeType: "video/mp4", buffer: bytes,
  });
  await expect(page.getByText(/Video uploaded securely to cloud storage\./)).toBeVisible({ timeout: 30_000 });
  const savedClip = page.getByTestId("saved-clip-details");
  if (!(await savedClip.evaluate((element) => (element as HTMLDetailsElement).open))) await savedClip.locator(":scope > summary").click();
  const details = page.getByTestId("analysis-disclosure");
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await details.locator("summary").click();
  const mockUnitConsent = details.getByRole("checkbox", { name: /I attest this is staged\/mock-unit footage/ });
  const providerConsent = details.getByRole("checkbox", { name: /I understand this selected mock-unit video and sampled stills/ });
  const processButton = details.getByRole("button", { name: "Approve & process this room", exact: true });
  await expect(mockUnitConsent).not.toBeChecked();
  await expect(providerConsent).not.toBeChecked();
  await expect(processButton).toBeDisabled();
  await mockUnitConsent.check();
  await expect(processButton).toBeDisabled();
  await providerConsent.check();
  await expect(processButton).toBeEnabled();
  expect(processRequests).toHaveLength(0);

  await processButton.click();
  await expect.poll(() => processRequests.length).toBe(1);
  await expect(page.getByRole("alert").filter({ hasText: "The provider may have completed this request before the worker stopped." })).toBeVisible();
  expect(processRequests[0]).toMatchObject({
    jobId: "mock-job-1",
    identity: {
      sessionId: expect.any(String),
      schemaVersion: expect.any(Number),
      videoId: expect.any(String),
      videoRevision: 1,
      analysisId: expect.any(String),
      attempt: 1,
      catalogVersion: expect.any(String),
      expectedVideoSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  });
  expect(cloud.requests.filter((request) => request.endsWith("/process"))).toHaveLength(1);
});
