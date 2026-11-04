/**
 * REQ-L2 offline analysis queue. A second local process serves the built app
 * with APP_ANALYSIS_MODE=live on :3102 (the queue runner requires live mode);
 * the suite runs with serial workers so this port reuse is safe. Playwright
 * intercepts every video API request before it reaches the server and answers
 * the segment stage with a stubbed zero-candidate response, so neither app
 * server can call Meta. The clip is the generated synthetic H.264 pattern.
 * This proves the queue/unchanged-chip/reconnect behavior only; it does not
 * validate live SAM/Muse behavior. The manual per-room pending intent keeps
 * its own explicit-retry coverage in move-in-ready.spec.ts.
 */
import { readFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { test, expect, type Page } from "@playwright/test";

import { goToCapture, openProfilePanel, selectRoom } from "./navigation";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 360, height: 800 },
  isMobile: true,
});

async function setLahsaProfile(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await openProfilePanel(page, "Unit & Funding");
  await page.getByLabel("Unit pseudonym").fill("Staged Demo Unit 04");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await page.getByLabel("Unit type").selectOption("studio");
  await openProfilePanel(page, "Evaluator");
  await page.getByLabel("Evaluator agency name").fill("Staged Demo Agency");
  await openProfilePanel(page, "Landlord & Agency");
  await page.getByLabel("Discussed with landlord?").selectOption("no");
  await openProfilePanel(page, "Evaluator");
}

async function browserCanDecodeH264(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const nativeCanDecode = document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"') !== "";
    if (typeof VideoDecoder === "undefined") return nativeCanDecode;
    try {
      const webCodecs = await VideoDecoder.isConfigSupported({
        codec: "avc1.42E01E",
        codedWidth: 320,
        codedHeight: 180,
      });
      return nativeCanDecode || webCodecs.supported === true;
    } catch {
      return nativeCanDecode;
    }
  });
}

const MOCK_LIVE_PORT = 3102;
const MOCK_LIVE_BASE_URL = `http://127.0.0.1:${MOCK_LIVE_PORT}`;
let mockLiveServer: ChildProcess | null = null;
let mockLiveServerOutput = "";

async function startMockLiveServer(): Promise<void> {
  const nextCli = path.join(process.cwd(), "node_modules/next/dist/bin/next");
  mockLiveServerOutput = "";
  mockLiveServer = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(MOCK_LIVE_PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_ANALYSIS_MODE: "live",
      META_API_KEY: "e2e-local-mock-key-never-sent-to-a-provider",
      MODEL_API_KEY: "",
      PORT: String(MOCK_LIVE_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  mockLiveServer.stdout?.on("data", (chunk: Buffer) => {
    mockLiveServerOutput = `${mockLiveServerOutput}${chunk.toString()}`.slice(-4_000);
  });
  mockLiveServer.stderr?.on("data", (chunk: Buffer) => {
    mockLiveServerOutput = `${mockLiveServerOutput}${chunk.toString()}`.slice(-4_000);
  });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (mockLiveServer.exitCode !== null) {
      throw new Error(`Mock-live E2E server exited early.\n${mockLiveServerOutput}`);
    }
    try {
      const response = await fetch(MOCK_LIVE_BASE_URL);
      if (response.ok) return;
    } catch {
      // Next may still be starting; retry only on this loopback port.
    }
    await delay(200);
  }
  await stopMockLiveServer();
  throw new Error(`Mock-live E2E server did not become ready.\n${mockLiveServerOutput}`);
}

async function stopMockLiveServer(): Promise<void> {
  const server = mockLiveServer;
  mockLiveServer = null;
  if (!server || server.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  server.kill("SIGTERM");
  await Promise.race([exited, delay(5_000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

interface MockVideoIdentity {
  sessionId: string;
  schemaVersion: number;
  videoId: string;
  videoRevision: number;
  analysisId: string;
  attempt: number;
  catalogVersion: string;
  expectedVideoSha256: string;
}

function multipartField(requestBody: Buffer, contentType: string, fieldName: string): string {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.slice(1).find(Boolean)?.trim();
  if (!boundary) throw new Error("The intercepted upload did not include a multipart boundary.");
  const parts = requestBody.toString("latin1").split(`--${boundary}`);
  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0 || !part.slice(0, headerEnd).includes(`name="${fieldName}"`)) continue;
    return part.slice(headerEnd + 4).replace(/\r\n$/, "");
  }
  throw new Error(`The intercepted upload was missing ${fieldName}.`);
}

function videoIdentityFromRequest(requestBody: Buffer, contentType: string): MockVideoIdentity {
  return {
    sessionId: multipartField(requestBody, contentType, "sessionId"),
    schemaVersion: Number(multipartField(requestBody, contentType, "schemaVersion")),
    videoId: multipartField(requestBody, contentType, "videoId"),
    videoRevision: Number(multipartField(requestBody, contentType, "videoRevision")),
    analysisId: multipartField(requestBody, contentType, "analysisId"),
    attempt: Number(multipartField(requestBody, contentType, "attempt")),
    catalogVersion: multipartField(requestBody, contentType, "catalogVersion"),
    expectedVideoSha256: multipartField(requestBody, contentType, "expectedVideoSha256"),
  };
}

test("offline clip save queues analysis and reconnect auto-starts it", async ({ page, context }) => {
  test.setTimeout(180_000);
  const segmentCalls: Array<{ stage: string; room: string }> = [];
  await page.route("**/api/video/segment*", async (route) => {
    const request = route.request();
    const stage = new URL(request.url()).searchParams.get("stage") ?? "";
    if (stage === "cancel") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, stage: "cancelled", released: true }),
      });
      return;
    }
    if (request.method() !== "POST" || stage !== "segment") {
      await route.fulfill({ status: 400, body: "Unexpected mocked video request." });
      return;
    }
    const body = request.postDataBuffer();
    if (!body) throw new Error(`The intercepted ${stage} request had no body.`);
    const contentType = request.headers()["content-type"] ?? "";
    const identity = videoIdentityFromRequest(body, contentType);
    const room = multipartField(body, contentType, "room");
    segmentCalls.push({ stage, room });
    // Minimal parseable segment shape: the client parser requires the echoed
    // identity, matching MP4 media, a non-empty sample schedule, and
    // mappingRequired false with no mapping token when no candidates return.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        stage: "segmented",
        models: { segmentation: "sam-3.1" },
        room,
        media: { container: "mp4", sourceVideoSha256: identity.expectedVideoSha256 },
        identity,
        candidates: [],
        sampleTimestampsMs: [500],
        mappingRequired: false,
        humanReviewRequired: true,
        conditionAssessment: "not_assessed",
      }),
    });
  });

  await startMockLiveServer();
  try {
    await page.goto(MOCK_LIVE_BASE_URL);
    await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
    await expect(page.getByTestId("analysis-mode")).toHaveText("Meta live · untested");
    await setLahsaProfile(page);
    await page.getByLabel("Evaluator name").fill("Staged Offline Evaluator");
    await goToCapture(page);
    await selectRoom(page, "kitchen");

    // Walkthrough consent is only offered before any clip is filmed and while
    // online, so grant it before dropping the connection.
    const consent = page.getByTestId("walkthrough-consent");
    await expect(consent).toBeVisible();
    await consent.getByRole("checkbox", { name: /Every clip I film is staged\/mock-unit footage/ }).check();
    await consent.getByRole("checkbox", { name: /I understand each filmed clip will be sent/ }).check();

    await context.setOffline(true);

    const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
    await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
      name: "synthetic-kitchen-offline-test-pattern.mp4",
      mimeType: "video/mp4",
      buffer: videoBytes,
    });
    expect(await browserCanDecodeH264(page), "this E2E needs the bundled synthetic MP4 to decode in Chromium").toBe(true);
    await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("analysis-queued-kitchen")).toBeVisible();

    // Negative assertion: the offline save must queue locally without sending.
    await page.waitForTimeout(2_000);
    expect(segmentCalls, "offline clip save must not call analysis").toHaveLength(0);

    await context.setOffline(false);
    await expect
      .poll(() => segmentCalls.length, { timeout: 60_000 })
      .toBeGreaterThan(0);
    expect(segmentCalls[0]?.room).toBe("kitchen");
  } finally {
    await context.setOffline(false);
    await page.unroute("**/api/video/segment*");
    await stopMockLiveServer();
  }
});
