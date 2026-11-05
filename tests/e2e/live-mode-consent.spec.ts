import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { expect, test } from "@playwright/test";

import { installCloudMocks } from "./cloud-mocks";
import { goToCapture } from "./navigation";

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

test("cloud upload sends no process request; analysis stays a separate explicit run", async ({ page }) => {
  const cloud = await installCloudMocks(page);
  const processRequests: string[] = [];
  await page.route("**/api/video/jobs/*/process", async (route) => {
    processRequests.push(route.request().url());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(BASE_URL);
  await expect(page.getByTestId("analysis-mode")).toHaveText("Meta live · untested");
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  const unitFunding = page.getByRole("button", { name: "Unit & Funding", exact: true });
  if (await unitFunding.getAttribute("aria-expanded") !== "true") await unitFunding.click();
  await page.getByLabel("Unit pseudonym").fill("Staged Cloud Test Unit 04");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await page.getByLabel("Unit type").selectOption("studio");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).click();
  await goToCapture(page);

  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "staged-live-consent.mp4", mimeType: "video/mp4", buffer: bytes,
  });
  await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
  const savedClip = page.getByTestId("saved-clip-details");
  if (!(await savedClip.evaluate((element) => (element as HTMLDetailsElement).open))) await savedClip.locator(":scope > summary").click();
  const details = page.getByTestId("analysis-disclosure");
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await details.locator("summary").click();
  const trigger = details.getByRole("button", { name: "Upload saved clip to cloud storage", exact: true });
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeDisabled();
  await details.getByRole("checkbox", { name: /I attest this is staged\/mock-unit footage/ }).check();
  await expect(trigger).toBeDisabled();
  await details.getByRole("checkbox", { name: /I understand this selected mock-unit video/ }).check();
  await expect(trigger).toBeEnabled();
  expect(processRequests).toHaveLength(0);

  await trigger.click();
  await expect(details.getByText(/uploaded to cloud storage as job mock-job-1\. Storage only: no analysis ran/)).toBeVisible({ timeout: 30_000 });
  expect(processRequests).toHaveLength(0);
  expect(cloud.requests.some((request) => request.endsWith("/process"))).toBe(false);
  // Analysis remains a separate explicit run on the saved on-device clip.
  await expect(details.getByRole("button", { name: "Analyze this room", exact: true })).toBeVisible();
});

test("saved clip uploads to cloud storage after consent and reports the real job", async ({ page }) => {
  const cloud = await installCloudMocks(page);
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
  await goToCapture(page);

  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "staged-cloud-backup.mp4", mimeType: "video/mp4", buffer: bytes,
  });
  await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });

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
  expect(cloud.requests.some((request) => request.startsWith("PUT /api/inspections/"))).toBe(true);
});
