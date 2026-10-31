/**
 * Browser acceptance for the current Move-in Ready Capture / Review /
 * Sign-Off / Profile flow. The webServer is pinned to APP_ANALYSIS_MODE=fixture
 * with no provider credentials passed by the shared suite. The delayed
 * response cases use a second local process with a synthetic test-only key;
 * Playwright intercepts each video API request before it reaches the server.
 * All content is limited to staged/mock-unit labels and evaluator-entered text.
 *
 * A generated H.264 test pattern covers local upload, browser decoding, and
 * source-still extraction. The delayed race cases return a mocked SAM response
 * through a browser-intercepted request; neither app server can call Meta.
 * This does not validate camera capture or live SAM/Muse behavior. The shared
 * fixture server is also asserted not to synthesize an analysis result.
 */
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { test, expect, type Locator, type Page } from "@playwright/test";

import { goToCapture, openProfilePanel, selectRoom } from "./navigation";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 360, height: 800 },
});

async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByTestId("analysis-mode")).toHaveText("Sample only");
}

async function setLahsaProfile(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await openProfilePanel(page, "Unit & Funding");
  await page.getByLabel("Unit pseudonym").fill("Staged Demo Unit 04");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await openProfilePanel(page, "Evaluator");
  await page.getByLabel("Evaluator agency name").fill("Staged Demo Agency");
  await openProfilePanel(page, "Landlord & Agency");
  await page.getByLabel("Discussed with landlord?").selectOption("no");
  await openProfilePanel(page, "Evaluator");
}

async function markCurrentElementAcceptable(activeElement: Locator): Promise<void> {
  if (await activeElement.getAttribute("data-testid") === "review-element-demo-smoke-co") {
    await activeElement.getByRole("group", { name: "Evaluator check for Form 1083 section 11a unit detectors" })
      .getByRole("button", { name: "A · Meets", exact: true }).click();
    await activeElement.getByRole("group", { name: "Evaluator check for Form 1083 section 11b public and common area detectors" })
      .getByRole("button", { name: "A · Meets", exact: true }).click();
    return;
  }
  await activeElement.getByRole("button", { name: "A · Acceptable", exact: true }).click();
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow, "360px app view must not scroll horizontally").toBeLessThanOrEqual(1);
}

async function expandAnalysisDetails(page: Page): Promise<void> {
  const savedClip = page.getByTestId("saved-clip-details");
  const clipDetailsOpen = await savedClip.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!clipDetailsOpen) await savedClip.locator("summary").first().click();
  const details = page.getByTestId("analysis-disclosure");
  const isOpen = await details.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!isOpen) await details.locator("summary").click();
}

async function expandSourceStills(page: Page): Promise<void> {
  const savedClip = page.getByTestId("saved-clip-details");
  const clipDetailsOpen = await savedClip.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!clipDetailsOpen) await savedClip.locator("summary").first().click();
  const details = page.getByTestId("source-stills-details");
  const isOpen = await details.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!isOpen) await details.locator("summary").click();
}

async function expandReviewDisclosure(element: Locator, label: RegExp): Promise<void> {
  const details = element.locator("details").filter({ hasText: label });
  const isOpen = await details.evaluate((node) => (node as HTMLDetailsElement).open);
  if (!isOpen) await details.locator("summary").click();
}

async function uploadRequiredRoomClips(page: Page, existingRoomIds: readonly string[] = []): Promise<void> {
  const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
  const rooms = ["kitchen", "bathroom", "bedroom-living", "hallway"] as const;
  const alreadySaved = new Set(existingRoomIds);
  let savedCount = alreadySaved.size;
  for (const roomId of rooms) {
    if (alreadySaved.has(roomId)) continue;
    await selectRoom(page, roomId);
    await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
      name: `synthetic-${roomId}-test-pattern.mp4`,
      mimeType: "video/mp4",
      buffer: videoBytes,
    });
    await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
    savedCount += 1;
    await expect(page.getByText(`${savedCount} of 4 clips saved`, { exact: true })).toBeVisible();
  }
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

function mockSegmentResponse(identity: MockVideoIdentity, room: string, candidateToken: string) {
  return {
    ok: true,
    stage: "segmented",
    models: { segmentation: "sam-3.1" },
    room,
    media: { container: "mp4", sourceVideoSha256: identity.expectedVideoSha256 },
    identity,
    candidates: [{
      candidateId: "cand-0001",
      elementId: "demo-water-supply",
      concept: "water faucet",
      evidence: {
        frameIndex: 1,
        timestampMs: 1_000,
        objectOrdinal: 0,
        box: { left: 10, top: 10, right: 80, bottom: 90 },
        samConfidence: 0.9,
      },
    }],
    sampleTimestampsMs: [500, 1_500, 2_500, 3_500],
    candidateToken,
    mappingExpiresAt: Date.now() + 60_000,
    mappingRequired: true,
    humanReviewRequired: true,
    conditionAssessment: "not_assessed",
  };
}

function mockMapResponse(identity: MockVideoIdentity, room: string, stillBytes: Buffer) {
  const stillSha256 = createHash("sha256").update(stillBytes).digest("hex");
  return {
    ok: true,
    stage: "mapped",
    models: { segmentation: "sam-3.1", mapping: "muse-spark-1.3" },
    room,
    media: { container: "mp4", sourceVideoSha256: identity.expectedVideoSha256 },
    identity,
    humanReviewRequired: true,
    conditionAssessment: "not_assessed",
    proposals: [{
      elementId: "demo-water-supply",
      state: "draft-proposal",
      modelSuggestion: "A",
      observation: `Mock ${room} water supply proposal.`,
      confidence: 92,
      evidenceCandidateIds: ["cand-0001"],
      evidence: [{
        candidateId: "cand-0001",
        elementId: "demo-water-supply",
        concept: "water faucet",
        evidence: {
          frameIndex: 1,
          timestampMs: 1_000,
          objectOrdinal: 0,
          box: { left: 10, top: 10, right: 80, bottom: 90 },
          samConfidence: 0.9,
        },
        still: {
          sha256: stillSha256,
          mimeType: "image/jpeg",
          width: 320,
          height: 180,
          base64: stillBytes.toString("base64"),
        },
      }],
    }],
  };
}

async function installSharedElementAnalysisMock(page: Page): Promise<{ stages: string[]; rooms: string[] }> {
  const stages: string[] = [];
  const rooms: string[] = [];
  const stillBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern-frame.jpg"));
  await page.route("**/api/video/segment*", async (route) => {
    const request = route.request();
    const stage = new URL(request.url()).searchParams.get("stage") ?? "";
    stages.push(stage);
    if (stage === "cancel") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, stage: "cancelled", released: true }),
      });
      return;
    }
    if (request.method() !== "POST" || (stage !== "segment" && stage !== "map")) {
      await route.fulfill({ status: 400, body: "Unexpected mocked video request." });
      return;
    }
    const body = request.postDataBuffer();
    if (!body) throw new Error(`The intercepted ${stage} request had no body.`);
    const contentType = request.headers()["content-type"] ?? "";
    const identity = videoIdentityFromRequest(body, contentType);
    const room = multipartField(body, contentType, "room");
    rooms.push(`${stage}:${room}`);
    if (stage === "segment") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockSegmentResponse(identity, room, `e2e-shared-element-${room}`)),
      });
      return;
    }
    const mappingBody = body.toString("latin1");
    if (/name="(?:video|still|sampleStill|sampleTimestampsMs)"/.test(mappingBody)) {
      throw new Error("The browser must not resend the clip or supply unverified pixels to the Muse mapping stage.");
    }
    if (multipartField(body, contentType, "candidateToken").length < 16) {
      throw new Error("The Muse mapping request did not retain its signed segmentation token.");
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockMapResponse(identity, room, stillBytes)),
    });
  });
  return { stages, rooms };
}

async function readSavedWaterSupplyDecision(page: Page): Promise<{
  status: string;
  analysisRoom: string | null;
  evidenceRoom: string | null;
  proposalState: string | null;
  signoffPresent: boolean;
} | null> {
  return page.evaluate(async () => {
    const sessionId = localStorage.getItem("move-in-ready-active-session-v1");
    if (!sessionId) throw new Error("The active mock walkthrough session was missing.");
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
      const decisions = row?.decisions as Record<string, Record<string, unknown>> | undefined;
      const decision = decisions?.["demo-water-supply"];
      const analysisIdentity = decision?.analysisIdentity as Record<string, unknown> | null | undefined;
      const evidence = decision?.evidence as Array<Record<string, unknown>> | undefined;
      const proposals = row?.proposals as Record<string, Record<string, unknown>> | undefined;
      const proposal = proposals?.["demo-water-supply"];
      return decision ? {
        status: String(decision.status),
        analysisRoom: typeof analysisIdentity?.roomId === "string" ? analysisIdentity.roomId : null,
        evidenceRoom: typeof evidence?.[0]?.roomId === "string" ? evidence[0].roomId : null,
        proposalState: typeof proposal?.state === "string" ? proposal.state : null,
        signoffPresent: Boolean(row?.signoff),
      } : null;
    } finally {
      db.close();
    }
  });
}

interface DelayedSegmentMock {
  requestStarted: Promise<{ identity: MockVideoIdentity; room: string }>;
  releaseResponse: () => void;
  responseSettled: Promise<void>;
  mappingStarted: Promise<{ identity: MockVideoIdentity; room: string }>;
  releaseMappingResponse: () => void;
  mappingResponseSettled: Promise<void>;
  stages: string[];
}

async function installDelayedSegmentMock(
  page: Page,
  testRun: string,
  options: { delayMapping?: boolean } = {},
): Promise<DelayedSegmentMock> {
  let release!: () => void;
  let didRelease = false;
  const responseGate = new Promise<void>((resolve) => {
    release = () => {
      if (didRelease) return;
      didRelease = true;
      resolve();
    };
  });
  let resolveStarted!: (request: { identity: MockVideoIdentity; room: string }) => void;
  const requestStarted = new Promise<{ identity: MockVideoIdentity; room: string }>((resolve) => {
    resolveStarted = resolve;
  });
  let resolveSettled!: () => void;
  const responseSettled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  let releaseMapping!: () => void;
  let didReleaseMapping = false;
  const mappingGate = new Promise<void>((resolve) => {
    releaseMapping = () => {
      if (didReleaseMapping) return;
      didReleaseMapping = true;
      resolve();
    };
  });
  let resolveMappingStarted!: (request: { identity: MockVideoIdentity; room: string }) => void;
  const mappingStarted = new Promise<{ identity: MockVideoIdentity; room: string }>((resolve) => {
    resolveMappingStarted = resolve;
  });
  let resolveMappingSettled!: () => void;
  const mappingResponseSettled = new Promise<void>((resolve) => {
    resolveMappingSettled = resolve;
  });
  const stages: string[] = [];
  const stillBytes = options.delayMapping
    ? await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern-frame.jpg"))
    : null;

  await page.route("**/api/video/segment*", async (route) => {
    const request = route.request();
    const stage = new URL(request.url()).searchParams.get("stage") ?? "";
    stages.push(stage);
    if (stage === "cancel") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, stage: "cancelled", released: true }),
      });
      return;
    }
    if (stage === "map") {
      if (!options.delayMapping || !stillBytes) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: { code: "TEST_UNEXPECTED_MAP", message: "Unexpected mocked map stage." } }),
        });
        return;
      }
      const body = request.postDataBuffer();
      if (!body) throw new Error("The intercepted mapping request had no body.");
      const contentType = request.headers()["content-type"] ?? "";
      const identity = videoIdentityFromRequest(body, contentType);
      const room = multipartField(body, contentType, "room");
      resolveMappingStarted({ identity, room });
      await mappingGate;
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockMapResponse(identity, room, stillBytes)),
        });
      } catch {
        // A request cancelled by the client can no longer consume this late body.
      } finally {
        resolveMappingSettled();
      }
      return;
    }
    if (stage !== "segment" || request.method() !== "POST") {
      await route.fulfill({ status: 400, body: "Unexpected mocked video request." });
      return;
    }

    const body = request.postDataBuffer();
    if (!body) throw new Error("The intercepted segment request had no body.");
    const contentType = request.headers()["content-type"] ?? "";
    const identity = videoIdentityFromRequest(body, contentType);
    const room = multipartField(body, contentType, "room");
    resolveStarted({ identity, room });
    await responseGate;
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockSegmentResponse(identity, room, `e2e-candidate-token-${testRun}`)),
      });
    } catch {
      // A request cancelled by the client can no longer consume this late body.
    } finally {
      resolveSettled();
    }
  });

  return {
    requestStarted,
    releaseResponse: release,
    responseSettled,
    mappingStarted,
    releaseMappingResponse: releaseMapping,
    mappingResponseSettled,
    stages,
  };
}

async function replacePersistedClipDuringRequest(page: Page, videoBase64: string, fileName: string): Promise<void> {
  await page.evaluate(async ({ encodedVideo, nextFileName }) => {
    const sessionId = localStorage.getItem("move-in-ready-active-session-v1");
    if (!sessionId) throw new Error("The active mock walkthrough session was missing.");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("move-in-ready-video-clips", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open local video storage."));
    });
    const rowId = `${encodeURIComponent(sessionId)}::kitchen`;
    const readTransaction = db.transaction("clips", "readonly");
    const readDone = new Promise<void>((resolve, reject) => {
      readTransaction.oncomplete = () => resolve();
      readTransaction.onerror = () => reject(readTransaction.error ?? new Error("Could not read local video storage."));
      readTransaction.onabort = () => reject(readTransaction.error ?? new Error("The local video read was cancelled."));
    });
    const row = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const request = readTransaction.objectStore("clips").get(rowId);
      request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
      request.onerror = () => reject(request.error ?? new Error("Could not read the stored room clip."));
    });
    await readDone;
    if (!row) throw new Error("The room clip was missing before the delayed response.");

    const binary = atob(encodedVideo);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const video = new Blob([bytes], { type: "video/mp4" });
    const digest = await crypto.subtle.digest("SHA-256", await video.arrayBuffer());
    const sourceSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const oldCapturedAt = typeof row.capturedAt === "string" ? Date.parse(row.capturedAt) : Number.NaN;
    if (!Number.isFinite(oldCapturedAt)) throw new Error("The stored room clip has no valid capture time.");
    const replacement = {
      ...row,
      fileName: nextFileName,
      capturedAt: new Date(oldCapturedAt + 60_000).toISOString(),
      video,
      sizeBytes: video.size,
      sourceSha256,
    };
    const writeTransaction = db.transaction("clips", "readwrite");
    const writeDone = new Promise<void>((resolve, reject) => {
      writeTransaction.oncomplete = () => resolve();
      writeTransaction.onerror = () => reject(writeTransaction.error ?? new Error("Could not replace the stored room clip."));
      writeTransaction.onabort = () => reject(writeTransaction.error ?? new Error("The stored room replacement was cancelled."));
    });
    writeTransaction.objectStore("clips").put(replacement);
    await writeDone;
    db.close();
  }, { encodedVideo: videoBase64, nextFileName: fileName });
}

async function removePersistedClipDuringRequest(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const sessionId = localStorage.getItem("move-in-ready-active-session-v1");
    if (!sessionId) throw new Error("The active mock walkthrough session was missing.");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("move-in-ready-video-clips", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open local video storage."));
    });
    const transaction = db.transaction("clips", "readwrite");
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove the stored room clip."));
      transaction.onabort = () => reject(transaction.error ?? new Error("The local video removal was cancelled."));
    });
    transaction.objectStore("clips").delete(`${encodeURIComponent(sessionId)}::kitchen`);
    await done;
    db.close();
  });
}

async function prepareMockLiveVideo(page: Page, videoBytes: Buffer): Promise<void> {
  await page.goto(MOCK_LIVE_BASE_URL);
  await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
  await expect(page.getByTestId("analysis-mode")).toHaveText("Meta live · untested");
  await setLahsaProfile(page);
  await goToCapture(page);
  await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
    name: "delayed-response-test-pattern.mp4",
    mimeType: "video/mp4",
    buffer: videoBytes,
  });
  expect(await browserCanDecodeH264(page), "this E2E needs the bundled synthetic MP4 to decode in Chromium").toBe(true);
  await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
  await expandAnalysisDetails(page);
  const mockUnitAttestation = page.getByRole("checkbox", { name: /I attest this is staged\/mock-unit footage/ });
  const processingConsent = page.getByRole("checkbox", { name: /I understand this selected mock-unit video/ });
  const analyzeButton = page.getByRole("button", { name: "Analyze this room" });
  await expect(analyzeButton).toBeDisabled();
  await mockUnitAttestation.check();
  await expect(analyzeButton).toBeDisabled();
  await processingConsent.check();
  await expect(analyzeButton).toBeEnabled();
}

async function readPendingAnalysisIntent(page: Page): Promise<{
  roomId: string;
  schemaVersion: number;
  videoId: string;
  videoRevision: number;
  videoHash: string;
  catalogVersion: string;
  requestedAt: string;
} | null> {
  return page.evaluate(async () => {
    const sessionId = localStorage.getItem("move-in-ready-active-session-v1");
    if (!sessionId) throw new Error("The active mock walkthrough session was missing.");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("move-in-ready-inspections");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open local inspection storage."));
    });
    if (!db.objectStoreNames.contains("inspections")) {
      db.close();
      throw new Error("The local inspection store was not created.");
    }
    try {
      const row = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const request = db.transaction("inspections", "readonly").objectStore("inspections").get(sessionId);
        request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
        request.onerror = () => reject(request.error ?? new Error("Could not read local inspection storage."));
      });
      const pending = row?.pendingAnalysisIntent;
      if (!pending || typeof pending !== "object") return null;
      return pending as {
        roomId: string;
        schemaVersion: number;
        videoId: string;
        videoRevision: number;
        videoHash: string;
        catalogVersion: string;
        requestedAt: string;
      };
    } finally {
      db.close();
    }
  });
}

async function readStoredWalkthroughState(page: Page, sessionId: string): Promise<{
  clipCount: number;
  stillCount: number;
  record: { pseudonym: string; fundingType: string; signoff: unknown } | null;
}> {
  return page.evaluate(async (expectedSessionId) => {
    const inspectionDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("move-in-ready-inspections");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open local inspection storage."));
    });
    const videoDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("move-in-ready-video-clips");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open local video storage."));
    });
    try {
      const clipRows = await new Promise<Array<{ sessionId?: string; stills?: unknown[] }>>((resolve, reject) => {
        const request = videoDb.transaction("clips", "readonly").objectStore("clips").getAll();
        request.onsuccess = () => resolve(request.result as Array<{ sessionId?: string; stills?: unknown[] }>);
        request.onerror = () => reject(request.error ?? new Error("Could not read local video storage."));
      });
      const record = await new Promise<{ pseudonym: string; fundingType: string; signoff: unknown } | undefined>((resolve, reject) => {
        const request = inspectionDb.transaction("inspections", "readonly").objectStore("inspections").get(expectedSessionId);
        request.onsuccess = () => resolve(request.result as { pseudonym: string; fundingType: string; signoff: unknown } | undefined);
        request.onerror = () => reject(request.error ?? new Error("Could not read local inspection storage."));
      });
      const sessionClips = clipRows.filter((row) => row.sessionId === expectedSessionId);
      return {
        clipCount: sessionClips.length,
        stillCount: sessionClips.reduce((count, row) => count + (row.stills?.length ?? 0), 0),
        record: record ? { pseudonym: record.pseudonym, fundingType: record.fundingType, signoff: record.signoff } : null,
      };
    } finally {
      inspectionDb.close();
      videoDb.close();
    }
  }, sessionId);
}

test.describe("Move-in Ready mobile flow", () => {
  test("360px shows the four navigation items and keeps default Capture usable without horizontal scroll", async ({ page }) => {
    await openApp(page);
    await mkdir(path.join(process.cwd(), "artifacts/design-qa"), { recursive: true });
    await expect(page.getByRole("heading", { level: 1, name: "Inspection home" })).toBeVisible();
    await goToCapture(page);
    const setupToggle = page.getByTestId("capture-setup-toggle");
    await expect(setupToggle).toHaveAttribute("aria-expanded", "true");
    const firstRunCapture = page.getByTestId("walkthrough-video-capture");
    await expect(firstRunCapture).toBeVisible();
    await expect(page.getByTestId("capture-setup-gate")).toBeVisible();
    await expect(firstRunCapture.getByText("No video recorded for this room yet.", { exact: true })).toBeVisible();
    await expect(firstRunCapture.getByRole("button", { name: "Start recording", exact: true })).toBeDisabled();
    await expect(firstRunCapture.getByRole("button", { name: "Upload video", exact: true })).toBeDisabled();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "artifacts/design-qa/capture-first-run-360.png" });
    await setLahsaProfile(page);

    await goToCapture(page);
    await page.locator("#main-content").evaluate((element) => element.scrollTo(0, 0));
    await expect(page.getByRole("heading", { level: 1, name: "Film the unit" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    const roomPicker = page.getByTestId("room-picker-toggle");
    await expect(roomPicker).toBeVisible();
    await expect(roomPicker).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("group", { name: "Room selection" })).toBeHidden();
    await page.screenshot({ path: "artifacts/design-qa/capture-360.png" });

    await roomPicker.click();
    await expect(roomPicker).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("room-step-bathroom")).toBeVisible();
    await roomPicker.click();

    const mainNav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(mainNav.getByRole("button")).toHaveCount(4);
    for (const label of ["Home", "Review", "Sign-Off", "Profile"]) {
      await expect(mainNav.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await expect(mainNav.getByRole("button", { name: "Capture", exact: true })).toHaveCount(0);
    const navBox = await mainNav.boundingBox();
    const mainBox = await page.locator("#main-content").boundingBox();
    const uploadBox = await page.getByRole("button", { name: "Upload video", exact: true }).boundingBox();
    const capture = page.getByTestId("walkthrough-video-capture");
    const promptRows = capture.getByRole("listitem");
    const firstPromptBox = await promptRows.first().boundingBox();
    const lastPromptBox = await promptRows.last().boundingBox();
    expect(uploadBox).not.toBeNull();
    expect(firstPromptBox).not.toBeNull();
    expect(lastPromptBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    expect(mainBox!.y + mainBox!.height).toBeLessThanOrEqual(navBox!.y);
    expect(uploadBox!.y + uploadBox!.height).toBeLessThanOrEqual(navBox!.y - 4);
    expect(firstPromptBox!.y + firstPromptBox!.height).toBeLessThanOrEqual(navBox!.y - 4);
    expect(lastPromptBox!.y + lastPromptBox!.height).toBeLessThanOrEqual(navBox!.y - 4);
    await expect(page.getByRole("button", { name: "Continue to draft review", exact: true })).toHaveCount(0);
    const shellMetrics = await page.evaluate(() => {
      const main = document.getElementById("main-content");
      if (!main) throw new Error("The mobile screen scroller is missing.");
      return {
        appHeight: document.querySelector("[data-testid='move-in-ready-app']")?.getBoundingClientRect().height ?? 0,
        viewportHeight: window.innerHeight,
        mainOverflow: getComputedStyle(main).overflowY,
        mainScrollHeight: main.scrollHeight,
        mainClientHeight: main.clientHeight,
        documentScrollHeight: document.documentElement.scrollHeight,
      };
    });
    expect(shellMetrics.appHeight).toBeCloseTo(shellMetrics.viewportHeight, 0);
    expect(shellMetrics.mainOverflow).toBe("auto");
    expect(shellMetrics.documentScrollHeight).toBeLessThanOrEqual(shellMetrics.viewportHeight + 1);
    expect(shellMetrics.mainScrollHeight).toBeGreaterThanOrEqual(shellMetrics.mainClientHeight);
    await expect(page.getByText("Not filmed", { exact: true }).first()).toBeVisible();
    await expect(promptRows).toHaveCount(1);
    await expect(page.getByRole("button", { name: /Mark filmed: Film one continuous take/, exact: false })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /View all \d+ prompts/ })).toHaveCount(0);
    const kitchenPrompt = capture.getByText("Film one continuous take: run the faucet showing flow and drainage, pan the sink, counters, and outlets with the fan running, open the entry and test its lock, then show the smoke or CO detector and its indicator.", { exact: true });
    await expect(kitchenPrompt).toBeVisible();
    const promptTextMetrics = await kitchenPrompt.evaluate((element) => ({
      isClipped: element.scrollHeight > element.clientHeight,
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    }));
    expect(promptTextMetrics.isClipped).toBe(false);
    expect(promptTextMetrics.fontSize).toBeGreaterThanOrEqual(10);
    await page.getByRole("heading", { name: "Filming guide" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/design-qa/capture-prompts-360.png" });

    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    const views = [
      ["Review", "Requirement checklist"],
      ["Sign-Off", "Sign-Off & Export"],
      ["Profile", "Profile"],
    ] as const;

    for (const [tab, heading] of views) {
      const button = navigation.getByRole("button", { name: tab, exact: true });
      await button.click();
      await page.locator("#main-content").evaluate((element) => element.scrollTo(0, 0));
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(button).toHaveAttribute("aria-current", "page");
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `artifacts/design-qa/${tab.toLowerCase().replaceAll("-", "")}-360.png` });
      const bottomNav = page.getByRole("navigation", { name: "Main navigation" });
      const navBox = await bottomNav.boundingBox();
      if (tab === "Sign-Off") {
        for (const name of [/Client-file export/, /Landlord fix-list/, /^PDF$/, /^JSON$/]) {
          const box = await page.getByRole("button", { name }).boundingBox();
          expect(box).not.toBeNull();
          expect(navBox).not.toBeNull();
          expect(box!.y + box!.height).toBeLessThanOrEqual(navBox!.y - 4);
        }
      }
      if (tab === "Profile") {
        const moreSettings = page.getByTestId("profile-more-settings");
        await expect(moreSettings).toHaveJSProperty("open", false);
        const installDisclosure = page.getByTestId("profile-install-disclosure");
        await expect(installDisclosure).toHaveJSProperty("open", false);
        await moreSettings.locator(":scope > summary").click();
        await expect(moreSettings).toHaveJSProperty("open", true);
        await installDisclosure.locator("summary").click();
        await expect(installDisclosure).toHaveJSProperty("open", true);
        const installButton = page.getByRole("button", { name: "Show install steps", exact: true });
        await expect(installButton).toHaveAttribute("aria-expanded", "false");
        await expect(page.getByTestId("install-steps")).toHaveCount(0);
        await installButton.click();
        await expect(page.getByRole("button", { name: "Hide install steps", exact: true })).toHaveAttribute("aria-expanded", "true");
        await expect(page.getByTestId("install-steps")).toBeVisible();
        await page.getByRole("button", { name: "Hide install steps", exact: true }).click();
        await expect(page.getByTestId("install-steps")).toHaveCount(0);
        const privacyDisclosure = page.getByTestId("profile-privacy-disclosure");
        await expect(privacyDisclosure).toHaveJSProperty("open", false);
        await privacyDisclosure.locator("summary").click();
        await expect(privacyDisclosure).toHaveJSProperty("open", true);
        await expect(page.getByText(/Potential provider charges/i)).toBeVisible();
        await expect(page.getByText(/does not mean that a provider request has run or succeeded/i)).toBeVisible();
        await expect(page.getByText(/selected room video is sent to this server and Meta for SAM/i)).toBeVisible();
        await page.getByRole("button", { name: "Back to home", exact: true }).click();
        await goToCapture(page);
      }
    }
  });

  test("Profile guides one completed setup section at a time and gates the landlord date on YES", async ({ page }) => {
    await openApp(page);
    await page.getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Profile", exact: true }).click();

    const setup = page.getByRole("region", { name: "Profile setup" });
    const progress = setup.getByRole("progressbar", { name: "Profile setup progress" });
    await expect(setup.getByRole("button", { name: "Unit & Funding", exact: true }).getByText("Unit", { exact: true })).toBeVisible();
    await expect(setup.getByRole("button", { name: "Landlord & Agency", exact: true }).getByText("Agency", { exact: true })).toBeVisible();
    await expect(progress).toHaveAttribute("aria-valuenow", "0");
    await openProfilePanel(page, "Unit & Funding");
    await expect(setup.getByRole("button", { name: "Unit & Funding", exact: true })).toHaveAttribute("aria-current", "step");
    await expect(setup.getByLabel("Landlord-discussion date")).toHaveCount(0);

    await page.getByLabel("Unit pseudonym").fill("Staged Profile Flow Unit");
    await page.getByLabel("Funding type").selectOption("lahsa");
    await expect(progress).toHaveAttribute("aria-valuenow", "1");
    await expect(setup.getByRole("button", { name: "Unit & Funding", exact: true })).toContainText("Ready");

    await openProfilePanel(page, "Evaluator");
    await page.getByLabel("Evaluator name").fill("Staged Profile Evaluator");
    await page.getByLabel("Evaluator agency name").fill("Staged Profile Agency");
    await expect(progress).toHaveAttribute("aria-valuenow", "2");
    await expect(setup.getByRole("button", { name: "Evaluator", exact: true })).toContainText("Ready");

    await openProfilePanel(page, "Landlord & Agency");
    await expect(setup.getByLabel("Landlord-discussion date")).toHaveCount(0);
    await page.getByLabel("Discussed with landlord?").selectOption("no");
    await expect(setup.getByLabel("Landlord-discussion date")).toHaveCount(0);
    await page.getByLabel("Discussed with landlord?").selectOption("yes");
    const landlordDate = setup.getByLabel("Landlord-discussion date");
    await expect(landlordDate).toBeVisible();
    await landlordDate.fill("2026-10-29");
    await expect(progress).toHaveAttribute("aria-valuenow", "3");
    await expect(setup.getByRole("button", { name: "Landlord & Agency", exact: true })).toContainText("Ready");
  });

  test("Profile clear removes this device's clips, stills, and saved walkthrough", async ({ page }) => {
    const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
    await openApp(page);
    await setLahsaProfile(page);
    await goToCapture(page);
    const oldSessionId = await page.evaluate(() => localStorage.getItem("move-in-ready-active-session-v1"));
    expect(oldSessionId).toBeTruthy();
    await expect.poll(async () => (await readStoredWalkthroughState(page, oldSessionId!)).record)
      .toMatchObject({ pseudonym: "Staged Demo Unit 04", fundingType: "lahsa" });
    await page.evaluate(async ({ sessionId, videoBase64, sourceSha256, capturedAt }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("move-in-ready-video-clips", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Could not open local video storage."));
      });
      try {
        const binary = atob(videoBase64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const video = new Blob([bytes], { type: "video/mp4" });
        const still = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
        const row = {
          id: `${encodeURIComponent(sessionId)}::kitchen`,
          schemaVersion: 2,
          sessionId,
          roomId: "kitchen",
          roomLabel: "Kitchen",
          fileName: "local-clear-test-pattern.mp4",
          mime: "video/mp4",
          sizeBytes: video.size,
          durationSeconds: 1,
          width: 320,
          height: 180,
          capturedAt,
          sourceSha256,
          video,
          stills: [{ timestampSeconds: 0.5, blob: still, width: 1, height: 1 }],
        };
        const transaction = db.transaction("clips", "readwrite");
        const done = new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error ?? new Error("Could not stage the local video fixture."));
          transaction.onabort = () => reject(transaction.error ?? new Error("Staging the local video fixture was cancelled."));
        });
        transaction.objectStore("clips").put(row);
        await done;
      } finally {
        db.close();
      }
    }, {
      sessionId: oldSessionId!,
      videoBase64: videoBytes.toString("base64"),
      sourceSha256: createHash("sha256").update(videoBytes).digest("hex"),
      capturedAt: new Date().toISOString(),
    });

    await page.reload();
    await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
    await goToCapture(page);
    await expect(page.getByText("1 of 4 clips saved", { exact: true })).toBeVisible();
    const before = await readStoredWalkthroughState(page, oldSessionId!);
    expect(before.clipCount).toBe(1);
    expect(before.stillCount).toBeGreaterThan(0);
    expect(before.record).toMatchObject({ pseudonym: "Staged Demo Unit 04", fundingType: "lahsa" });

    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    const moreSettings = page.getByTestId("profile-more-settings");
    if (await moreSettings.evaluate((node) => !(node as HTMLDetailsElement).open)) await moreSettings.locator(":scope > summary").click();
    const localData = page.locator("details").filter({ hasText: "Local data" }).last();
    if (await localData.evaluate((node) => !(node as HTMLDetailsElement).open)) await localData.locator(":scope > summary").click();
    await page.getByRole("button", { name: "Clear this walkthrough from this device", exact: true }).click();
    await expect(page.getByText(/Local data for this walkthrough was removed/)).toBeVisible();

    const newSessionId = await page.evaluate(() => localStorage.getItem("move-in-ready-active-session-v1"));
    expect(newSessionId).toBeTruthy();
    expect(newSessionId).not.toBe(oldSessionId);
    await expect.poll(async () => readStoredWalkthroughState(page, oldSessionId!).then((state) => state.clipCount)).toBe(0);
    const after = await readStoredWalkthroughState(page, oldSessionId!);
    expect(after).toMatchObject({ clipCount: 0, stillCount: 0, record: null });

    await page.reload();
    await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByLabel("Unit pseudonym")).toHaveValue("");
    await expect(page.getByLabel("Funding type")).toHaveValue("unknown");
    await page.getByRole("button", { name: "Back to home", exact: true }).click();
    await goToCapture(page);
    await expect(page.getByText("Set up this unit to begin recording.", { exact: true })).toBeVisible();
  });

  test("the full filming checklist stays room-scoped and resets when its clip changes", async ({ page }) => {
    test.setTimeout(60_000);
    const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
    await openApp(page);
    await setLahsaProfile(page);
    await goToCapture(page);
    await expandAnalysisDetails(page);
    expect(await browserCanDecodeH264(page), "this E2E needs the bundled synthetic MP4 to decode in Chromium").toBe(true);

    await expect(page.getByText("Not filmed", { exact: true }).first()).toBeVisible();
    const capture = page.getByTestId("walkthrough-video-capture");
    const kitchenPrompt = capture.getByRole("listitem").filter({ hasText: "Film one continuous take" });
    await expect(capture.getByRole("listitem")).toHaveCount(1);
    await expect(kitchenPrompt).toBeVisible();

    await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
      name: "prompt-kitchen-test-pattern.mp4",
      mimeType: "video/mp4",
      buffer: videoBytes,
    });
    await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
    const stillsDisclosure = page.getByTestId("source-stills-details");
    await expect(stillsDisclosure).toHaveJSProperty("open", false);
    await expect(page.getByRole("region", { name: "Source stills from saved video" })).toHaveCount(0);
    await expandSourceStills(page);
    const stillsScroller = page.getByRole("region", { name: "Source stills from saved video" });
    await expect(stillsScroller.locator("img").first()).toBeVisible();
    await expect.poll(() => stillsScroller.evaluate((element) => getComputedStyle(element).overflowX)).toBe("auto");
    await page.getByRole("button", { name: /Mark filmed: Film one continuous take/, exact: false }).click();
    await expect(page.getByText("Filmed", { exact: true }).first()).toBeVisible();
    await expect(kitchenPrompt.getByRole("button", { name: /Undo filmed: Film one continuous take/, exact: false })).toBeVisible();

    await selectRoom(page, "bathroom");
    await expect(page.getByText("Not filmed", { exact: true }).first()).toBeVisible();
    await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
      name: "prompt-bathroom-test-pattern.mp4",
      mimeType: "video/mp4",
      buffer: videoBytes,
    });
    await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /Mark filmed: Film one continuous take/, exact: false }).click();
    await expect(page.getByText("Filmed", { exact: true }).first()).toBeVisible();

    await selectRoom(page, "kitchen");
    await expect(page.getByText("Filmed", { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(1_100);
    await page.getByRole("button", { name: "Replace clip", exact: true }).click();
    await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
      name: "replacement-kitchen-test-pattern.mp4",
      mimeType: "video/mp4",
      buffer: videoBytes,
    });
    await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Not filmed", { exact: true }).first()).toBeVisible();

    await selectRoom(page, "bathroom");
    await expect(page.getByText("Filmed", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Remove clip", exact: true }).click();
    await expect(page.getByText("Not filmed", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Mark filmed: Film one continuous take/, exact: false })).toHaveCount(0);
  });

  test("HUD routes to HQS and blocks this Form 1083 capture and export path", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await openProfilePanel(page, "Unit & Funding");
    await page.getByLabel("Unit pseudonym").fill("Staged Demo Unit 04");
    await page.getByLabel("Funding type").selectOption("hud");

    await expect(page.getByText("HQS inspection required.", { exact: false })).toBeVisible();
    await expect(page.getByTestId("walkthrough-video-capture")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Room progress" })).toHaveCount(0);

    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(page.getByText(
      "HQS is required for HUD-funded units",
      { exact: false },
    )).toBeVisible();
    await expect(page.getByRole("heading", { name: "HQS required", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "HQS inspection required" })).toBeVisible();
    await expect(page.getByRole("region", { name: "All 11 inspection elements" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Sign-Off", exact: true }).click();
    await expect(page.getByText(
      "This app cannot complete or export a Form 1083 result for a HUD-funded unit.",
      { exact: false },
    )).toBeVisible();
    await expect(page.getByRole("heading", { name: "HQS required", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Form 1083 sign-off is unavailable" })).toBeVisible();
    await expect(page.getByTestId("inspection-result")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign inspection" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Client-file export|Landlord fix-list|^PDF$|^JSON$/ })).toHaveCount(0);

    await setLahsaProfile(page);
    await goToCapture(page);
    await expect(page.getByTestId("walkthrough-video-capture")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload video" })).toBeVisible();
  });

  test("unknown funding shows choose-funding gates on Review and Sign-Off with no LAHSA controls", async ({ page }) => {
    await openApp(page);
    // A fresh inspection defaults to unknown funding; set no funding type here.

    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Choose funding type", exact: true })).toBeVisible();
    await expect(page.getByText("Choose the applicable route in Profile before reviewing.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a funding type", exact: true })).toBeVisible();
    await expect(page.getByText("Funding type is required.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Review funding type/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "All 11 inspection elements" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Sign-Off", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Choose funding type", exact: true })).toBeVisible();
    await expect(page.getByText("Funding type required.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose the correct workflow", exact: true })).toBeVisible();
    await expect(page.getByTestId("inspection-result")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign inspection" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Client-file export|Landlord fix-list|^PDF$|^JSON$/ })).toHaveCount(0);

    await setLahsaProfile(page);
    await goToCapture(page);
    await expect(page.getByTestId("walkthrough-video-capture")).toBeVisible();
  });

  test("fixture mode gives no video result when there is no staged clip", async ({ page }) => {
    const videoRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/video/segment")) videoRequests.push(request.url());
    });

    await openApp(page);
    await setLahsaProfile(page);
    await goToCapture(page);
    await expandAnalysisDetails(page);

    await expect(page.getByRole("button", { name: /Inspection setup/ })).toHaveCount(0);
    await expect(page.getByText("Sample mode is active. This video flow will not invent a sample result or fall back when live analysis is unavailable.")).toBeVisible();
    await expect(page.getByText("No video recorded for this room yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyze this room" })).toBeDisabled();

    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("region", { name: "All 11 inspection elements" }).locator("#element-overview-list").getByRole("button").filter({ hasText: "Structure and materials" }).click();
    const structureReview = page.locator('[data-testid^="review-element-"]');
    await expect(structureReview.getByText("No AI draft for this element. Assess it with the source clip and the required in-person checks.", { exact: true })).toBeVisible();
    expect(videoRequests, "without an uploaded clip, no segment or map request should be made").toHaveLength(0);
    // No video is staged in this test. Upload, segmentation, and mapping are
    // intentionally not claimed as covered by this fixture-only assertion.
  });

  test("keyboard focus and accessible labels reach the room video controls", async ({ page }) => {
    await openApp(page);

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeInViewport();

    await setLahsaProfile(page);
    await goToCapture(page);
    const roomPicker = page.getByTestId("room-picker-toggle");
    if (await roomPicker.isVisible()) await roomPicker.click();
    const kitchenRoomStep = page.getByTestId("room-step-kitchen");
    const bathroomRoomStep = page.getByTestId("room-step-bathroom");
    await expect(kitchenRoomStep).toHaveAccessibleName(/Room 1: Kitchen, selected, no clip saved/);
    await kitchenRoomStep.focus();
    await expect(kitchenRoomStep).toBeFocused();
    await bathroomRoomStep.focus();
    await expect(bathroomRoomStep).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(bathroomRoomStep).toHaveAttribute("aria-pressed", "true");

    const cameraInput = page.getByLabel("Record a room video with the phone camera");
    const uploadInput = page.getByLabel("Upload an MP4 or MOV room video");
    await expect(cameraInput).toBeAttached();
    await expect(uploadInput).toBeAttached();
    await expect(cameraInput).toHaveAttribute("accept", /video\/mp4.*video\/quicktime/);
    await expect(uploadInput).toHaveAttribute("accept", /video\/mp4.*video\/quicktime/);

    const uploadButton = page.getByRole("button", { name: "Upload video", exact: true });
    await uploadButton.focus();
    await expect(uploadButton).toBeFocused();
    await expect(uploadButton).toHaveAccessibleName("Upload video");
    const outlineStyle = await uploadButton.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outlineStyle, "keyboard focus must have a visible indicator").toBe("solid");
  });

  test("synthetic MP4 upload follows browser decoder support and preserves room-clip boundaries", async ({ page }) => {
    const segmentRequests: string[] = [];
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("request", (request) => {
      if (request.url().includes("/api/video/segment")) segmentRequests.push(request.url());
    });

    await openApp(page);
    await setLahsaProfile(page);
    await goToCapture(page);

    const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
    const upload = page.getByLabel("Upload an MP4 or MOV room video");
    const browserSupportsVideo = await browserCanDecodeH264(page);
    await upload.setInputFiles({ name: "synthetic-h264-test-pattern.mp4", mimeType: "video/mp4", buffer: videoBytes });
    if (!browserSupportsVideo) {
      await expect(page.getByRole("alert").filter({ hasText: "could not decode the selected video" }))
        .toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("No video recorded for this room yet.")).toBeVisible();
      expect(segmentRequests, "a browser decode failure must never call the analysis route").toHaveLength(0);
      return;
    }
    try {
      await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
    } catch (error) {
      const alerts = await page.getByRole("alert").allTextContents();
      throw new Error(`${String(error)}\nBrowser errors: ${browserErrors.join(" | ")}\nAlerts: ${alerts.join(" | ")}`);
    }
    const stillsDisclosure = page.getByTestId("source-stills-details");
    await expect(stillsDisclosure).toHaveJSProperty("open", false);
    await expandSourceStills(page);
    await expect(page.getByRole("img", { name: /Source video frame at/ })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Replace clip" })).toBeVisible();
    await expect(page.getByText("synthetic-h264-test-pattern.mp4", { exact: true })).toBeVisible();

    await upload.setInputFiles({
      name: "corrupt-replacement.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("not a video container"),
    });
    await expect(page.getByRole("alert").filter({ hasText: "valid MP4 or MOV video header" })).toContainText("valid MP4 or MOV video header");
    await expect(page.getByText("synthetic-h264-test-pattern.mp4", { exact: true })).toBeVisible();
    await expandSourceStills(page);
    await expect(page.getByRole("img", { name: /Source video frame at/ })).toHaveCount(3);

    await upload.setInputFiles({ name: "replacement-test-pattern.mp4", mimeType: "video/mp4", buffer: videoBytes });
    await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("replacement-test-pattern.mp4", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
    await goToCapture(page);
    await selectRoom(page, "kitchen");
    await expect(page.getByRole("button", { name: "Replace clip" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("replacement-test-pattern.mp4", { exact: true })).toBeVisible();
    const reloadedStillsDisclosure = page.getByTestId("source-stills-details");
    await expect(reloadedStillsDisclosure).toHaveJSProperty("open", false);
    await expandSourceStills(page);
    await expect(page.getByRole("img", { name: /Source video frame at/ })).toHaveCount(3);

    await page.getByRole("button", { name: "Remove clip", exact: true }).click();
    await expect(page.getByText("The room clip and its review stills were removed from this device.")).toBeVisible();
    await expect(page.getByText("No video recorded for this room yet.")).toBeVisible();
    await expect(page.getByRole("img", { name: /Source video frame at/ })).toHaveCount(0);
    expect(segmentRequests, "local upload and still extraction must not contact the live analysis route").toHaveLength(0);
  });

  test.describe("delayed video response identity guards", () => {
    test.beforeAll(async () => {
      await startMockLiveServer();
    });

    test.afterAll(async () => {
      await stopMockLiveServer();
    });

    test("offline analysis saves a pending intent and waits for an explicit retry", async ({ page }) => {
      test.setTimeout(90_000);
      const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
      const stages: string[] = [];
      await page.route("**/api/video/segment*", async (route) => {
        stages.push(new URL(route.request().url()).searchParams.get("stage") ?? "unknown");
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: { code: "MOCK_EXPLICIT_RETRY", message: "The explicit retry was intercepted by this E2E." },
          }),
        });
      });

      try {
        await prepareMockLiveVideo(page, videoBytes);
        await page.context().setOffline(true);
        await expect(page.getByText(/Offline\./)).toBeVisible();
        const analyze = page.getByRole("button", { name: "Queue analysis for when connected", exact: true });
        await expect(analyze).toBeEnabled();
        await analyze.click();

        await expect(page.getByRole("status").filter({ hasText: /waiting/i })).toBeVisible();
        const pendingIntent = await readPendingAnalysisIntent(page);
        expect(pendingIntent).not.toBeNull();
        expect(pendingIntent).toMatchObject({
          roomId: "kitchen",
          schemaVersion: expect.any(Number),
          videoId: expect.any(String),
          videoRevision: expect.any(Number),
          videoHash: expect.any(String),
          catalogVersion: expect.any(String),
          requestedAt: expect.any(String),
        });
        expect(stages, "offline analysis must queue locally without sending a request").toHaveLength(0);

        await page.context().setOffline(false);
        await expect(page.getByRole("button", { name: "Retry analysis", exact: true })).toBeVisible();
        const automaticRequest = await page.waitForRequest("**/api/video/segment*", { timeout: 1_000 })
          .then(() => true)
          .catch(() => false);
        expect(automaticRequest, "reconnecting must not send the queued video automatically").toBe(false);
        expect(stages).toHaveLength(0);

        await page.getByRole("button", { name: "Retry analysis", exact: true }).click();
        await expect.poll(() => stages.some((stage) => stage === "segment")).toBe(true);
        expect(stages.filter((stage) => stage === "segment"), "explicit retry sends one segmentation request").toHaveLength(1);
        expect(stages).not.toContain("map");
      } finally {
        await page.context().setOffline(false);
        await page.unroute("**/api/video/segment*");
      }
    });

    test("reanalyzing a shared element clears its old decision and persists the new room proposal", async ({ page }) => {
      test.setTimeout(120_000);
      const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
      const mock = await installSharedElementAnalysisMock(page);

      try {
        await prepareMockLiveVideo(page, videoBytes);
        await page.getByRole("button", { name: "Profile", exact: true }).click();
        await page.getByLabel("Evaluator name").fill("Mock Evaluator");
        await goToCapture(page);
        await selectRoom(page, "kitchen");
        await expandAnalysisDetails(page);
        await page.getByRole("checkbox", { name: /I attest this is staged\/mock-unit footage/ }).check();
        await page.getByRole("checkbox", { name: /I understand this selected mock-unit video/ }).check();
        await page.getByRole("button", { name: "Analyze this room", exact: true }).click();
        await expect(page.getByTestId("analysis-disclosure")).toHaveJSProperty("open", false);
        await expandAnalysisDetails(page);
        await expect(page.getByRole("button", { name: "Analyze this room again", exact: true })).toBeVisible({ timeout: 30_000 });

        await page.getByRole("button", { name: "Review", exact: true }).click();
        await page.getByRole("button", { name: "View all 11 requirements", exact: true }).click();
        const overview = page.getByRole("region", { name: "All 11 inspection elements" });
        const elementRows = overview.locator("#element-overview-list").getByRole("button");
        const waterSupplyRow = elementRows.filter({ hasText: "Water supply" });
        await waterSupplyRow.click();
        const waterSupply = page.getByTestId("review-element-demo-water-supply");
        await expect(waterSupply).toContainText("Mock kitchen water supply proposal.");
        await waterSupply.getByRole("button", { name: "A · Acceptable", exact: true }).click();
        const proposedStillCheckbox = waterSupply.getByRole("group", { name: "Attach source stills to your decision" })
          .getByRole("checkbox", { name: /SAM frame index 1/ });
        await expect(proposedStillCheckbox).toHaveCount(1);
        await proposedStillCheckbox.check();
        await waterSupply.getByLabel("Evaluator observation").fill("I checked the kitchen water supply in person.");
        await waterSupply.getByRole("checkbox", { name: "I completed every required in-person check for this element" }).check();
        await page.getByRole("button", { name: "Save evaluator decision", exact: true }).click();
        await expect(waterSupplyRow).toContainText("Approved");
        expect(await readSavedWaterSupplyDecision(page)).toMatchObject({
          status: "A",
          analysisRoom: "kitchen",
          evidenceRoom: "kitchen",
        });

        await goToCapture(page);
        await selectRoom(page, "bathroom");
        await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
          name: "synthetic-bathroom-test-pattern.mp4",
          mimeType: "video/mp4",
          buffer: videoBytes,
        });
        await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
        await expandAnalysisDetails(page);
        const mockUnitAttestation = page.getByRole("checkbox", { name: /I attest this is staged\/mock-unit footage/ });
        const processingConsent = page.getByRole("checkbox", { name: /I understand this selected mock-unit video/ });
        await expect(mockUnitAttestation).not.toBeChecked();
        await expect(processingConsent).not.toBeChecked();
        await expect(page.getByRole("button", { name: "Analyze this room", exact: true })).toBeDisabled();
        await mockUnitAttestation.check();
        await expect(page.getByRole("button", { name: "Analyze this room", exact: true })).toBeDisabled();
        await processingConsent.check();
        await expect(page.getByRole("button", { name: "Analyze this room", exact: true })).toBeEnabled();
        await page.getByRole("button", { name: "Analyze this room", exact: true }).click();
        await expect(page.getByTestId("analysis-disclosure")).toHaveJSProperty("open", false);
        await expandAnalysisDetails(page);
        await expect(page.getByRole("button", { name: "Analyze this room again", exact: true })).toBeVisible({ timeout: 30_000 });
        expect(mock.rooms).toEqual(["segment:kitchen", "map:kitchen", "segment:bathroom", "map:bathroom"]);

        await page.getByRole("button", { name: "Review", exact: true }).click();
        await page.getByRole("button", { name: "View all 11 requirements", exact: true }).click();
        await waterSupplyRow.click();
        await expect(waterSupply).toContainText("Mock bathroom water supply proposal.");
        await page.getByRole("button", { name: "Back to all 11 requirements", exact: true }).click();
        await expect(waterSupplyRow).toContainText("Open");
        expect(await readSavedWaterSupplyDecision(page)).toMatchObject({
          status: "unreviewed",
          analysisRoom: null,
          evidenceRoom: null,
        });

        await page.reload();
        await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
        await page.getByRole("button", { name: "Review", exact: true }).click();
        await page.getByRole("button", { name: "View all 11 requirements", exact: true }).click();
        const reloadedOverview = page.getByRole("region", { name: "All 11 inspection elements" });
        const reloadedWaterSupplyRow = reloadedOverview.locator("#element-overview-list").getByRole("button", { name: /Water supply/ });
        await reloadedWaterSupplyRow.click();
        await expect(page.getByTestId("review-element-demo-water-supply")).toContainText("Mock bathroom water supply proposal.");
        await page.getByRole("button", { name: "Back to all 11 requirements", exact: true }).click();
        await expect(reloadedWaterSupplyRow).toContainText("Open");
        expect(await readSavedWaterSupplyDecision(page)).toMatchObject({ status: "unreviewed" });
      } finally {
        if (!page.isClosed()) await page.unroute("**/api/video/segment*");
      }
    });

    test("a late response cannot attach stills to a clip replaced in local storage", async ({ page }) => {
      test.setTimeout(90_000);
      const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
      const replacementBytes = Buffer.from(videoBytes);
      // Change only the MP4 minor-version metadata; the H.264 video remains
      // decodable while the byte identity and server-side hash both change.
      replacementBytes.writeUInt32BE(replacementBytes.readUInt32BE(12) + 1, 12);
      const mock = await installDelayedSegmentMock(page, "replace-race");
      try {
        await prepareMockLiveVideo(page, videoBytes);
        await page.getByRole("button", { name: "Analyze this room", exact: true }).click();
        const started = await mock.requestStarted;
        expect(started.room).toBe("kitchen");
        await replacePersistedClipDuringRequest(page, replacementBytes.toString("base64"), "replacement-during-response.mp4");

        mock.releaseResponse();
        await mock.responseSettled;
        await expect(page.getByRole("alert").filter({ hasText: "The room clip changed before its source stills could be saved." })).toBeVisible({ timeout: 30_000 });
        expect(mock.stages.filter((stage) => stage === "map"), "a stale segmented response must not start Muse mapping").toHaveLength(0);

        await page.reload();
        await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
        await goToCapture(page);
        await selectRoom(page, "kitchen");
        await expect(page.getByRole("button", { name: "Replace clip" })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText("replacement-during-response.mp4", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Review", exact: true }).click();
        await page.getByRole("region", { name: "All 11 inspection elements" }).locator("#element-overview-list").getByRole("button").filter({ hasText: "Structure and materials" }).click();
        const structureReview = page.locator('[data-testid^="review-element-"]');
        await expect(structureReview.getByText(/No AI draft for this element\./)).toBeVisible();
      } finally {
        mock.releaseResponse();
        await Promise.race([mock.responseSettled, delay(2_000)]);
        await page.unroute("**/api/video/segment*");
      }
    });

    test("a late response cannot restore a clip removed from local storage", async ({ page }) => {
      test.setTimeout(90_000);
      const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
      const mock = await installDelayedSegmentMock(page, "remove-race");
      try {
        await prepareMockLiveVideo(page, videoBytes);
        await page.getByRole("button", { name: "Analyze this room", exact: true }).click();
        const started = await mock.requestStarted;
        expect(started.room).toBe("kitchen");
        await removePersistedClipDuringRequest(page);

        mock.releaseResponse();
        await mock.responseSettled;
        await expect(page.getByRole("alert").filter({ hasText: "The room clip changed before its source stills could be saved." })).toBeVisible({ timeout: 30_000 });
        expect(mock.stages.filter((stage) => stage === "map"), "a stale segmented response must not start Muse mapping").toHaveLength(0);

        await page.reload();
        await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
        await goToCapture(page);
        await expect(page.getByText("No video recorded for this room yet.")).toBeVisible({ timeout: 20_000 });
        await page.getByRole("button", { name: "Review", exact: true }).click();
        await page.getByRole("region", { name: "All 11 inspection elements" }).locator("#element-overview-list").getByRole("button").filter({ hasText: "Structure and materials" }).click();
        const structureReview = page.locator('[data-testid^="review-element-"]');
        await expect(structureReview.getByText(/No AI draft for this element\./)).toBeVisible();
      } finally {
        mock.releaseResponse();
        await Promise.race([mock.responseSettled, delay(2_000)]);
        await page.unroute("**/api/video/segment*");
      }
    });

    test("a late Muse response cannot attach evidence to a replacement clip", async ({ page }) => {
      test.setTimeout(90_000);
      const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
      const replacementBytes = Buffer.from(videoBytes);
      replacementBytes.writeUInt32BE(replacementBytes.readUInt32BE(12) + 1, 12);
      const mock = await installDelayedSegmentMock(page, "replace-during-map", { delayMapping: true });
      try {
        await prepareMockLiveVideo(page, videoBytes);
        await page.getByRole("button", { name: "Analyze this room", exact: true }).click();
        const segmentRequest = await mock.requestStarted;
        expect(segmentRequest.room).toBe("kitchen");
        mock.releaseResponse();
        await mock.responseSettled;

        const mappingRequest = await mock.mappingStarted;
        expect(mappingRequest.room).toBe("kitchen");
        expect(mock.stages).toEqual(["segment", "map"]);
        await replacePersistedClipDuringRequest(page, replacementBytes.toString("base64"), "replacement-during-map.mp4");

        mock.releaseMappingResponse();
        await mock.mappingResponseSettled;
        await page.reload();
        await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
        await goToCapture(page);
        await selectRoom(page, "kitchen");
        await expect(page.getByText("replacement-during-map.mp4", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Review", exact: true }).click();
        await page.getByRole("button", { name: "View all 11 requirements", exact: true }).click();
        const overview = page.getByRole("region", { name: "All 11 inspection elements" });
        const waterSupplyRow = overview.locator("#element-overview-list").getByRole("button", { name: /Water supply/ });
        await waterSupplyRow.click();
        await expect(page.getByTestId("review-element-demo-water-supply").getByText(/No AI draft for this element\./)).toBeVisible();
        expect(await readSavedWaterSupplyDecision(page)).toMatchObject({
          status: "unreviewed",
          proposalState: null,
          signoffPresent: false,
        });
      } finally {
        mock.releaseResponse();
        mock.releaseMappingResponse();
        await Promise.race([mock.responseSettled, mock.mappingResponseSettled, delay(2_000)]);
        await page.unroute("**/api/video/segment*");
      }
    });

    test("a late Muse response cannot restore a walkthrough cleared from this device", async ({ page }) => {
      test.setTimeout(90_000);
      const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));
      const mock = await installDelayedSegmentMock(page, "delete-during-map", { delayMapping: true });
      try {
        await prepareMockLiveVideo(page, videoBytes);
        const deletedSessionId = await page.evaluate(() => localStorage.getItem("move-in-ready-active-session-v1"));
        expect(deletedSessionId).toBeTruthy();
        await page.getByRole("button", { name: "Analyze this room", exact: true }).click();
        const segmentRequest = await mock.requestStarted;
        expect(segmentRequest.room).toBe("kitchen");
        mock.releaseResponse();
        await mock.responseSettled;
        const mappingRequest = await mock.mappingStarted;
        expect(mappingRequest.room).toBe("kitchen");

        page.on("dialog", (dialog) => dialog.accept());
        await page.getByRole("button", { name: "Profile", exact: true }).click();
        const moreSettings = page.getByTestId("profile-more-settings");
        if (await moreSettings.evaluate((node) => !(node as HTMLDetailsElement).open)) await moreSettings.locator(":scope > summary").click();
        const localData = page.locator("details").filter({ hasText: "Local data" }).last();
        if (await localData.evaluate((node) => !(node as HTMLDetailsElement).open)) await localData.locator(":scope > summary").click();
        await page.getByRole("button", { name: "Clear this walkthrough from this device", exact: true }).click();
        await expect(page.getByText(/Local data for this walkthrough was removed/)).toBeVisible();
        const activeSessionId = await page.evaluate(() => localStorage.getItem("move-in-ready-active-session-v1"));
        expect(activeSessionId).toBeTruthy();
        expect(activeSessionId).not.toBe(deletedSessionId);

        mock.releaseMappingResponse();
        await mock.mappingResponseSettled;
        await page.reload();
        await expect(page.getByTestId("move-in-ready-app")).toBeVisible();
        await page.getByRole("button", { name: "Profile", exact: true }).click();
        await expect(page.getByLabel("Unit pseudonym")).toHaveValue("");
        await page.getByRole("button", { name: "Back to home", exact: true }).click();
        await goToCapture(page);
        await expect(page.getByText("Set up this unit to begin recording.", { exact: true })).toBeVisible();
        const deleted = await readStoredWalkthroughState(page, deletedSessionId!);
        expect(deleted).toMatchObject({ clipCount: 0, stillCount: 0, record: null });
        expect(await readSavedWaterSupplyDecision(page)).toMatchObject({
          status: "unreviewed",
          proposalState: null,
          signoffPresent: false,
        });
      } finally {
        mock.releaseResponse();
        mock.releaseMappingResponse();
        await Promise.race([mock.responseSettled, mock.mappingResponseSettled, delay(2_000)]);
        await page.unroute("**/api/video/segment*");
      }
    });
  });

  test("one human check remains incomplete and blocks sign-off and every export", async ({ page }) => {
    await openApp(page);
    await setLahsaProfile(page);
    await page.getByLabel("Evaluator name").fill("Mock Evaluator");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("region", { name: "All 11 inspection elements" }).locator("#element-overview-list").getByRole("button").filter({ hasText: "Structure and materials" }).click();

    const element = page.getByTestId("review-element-demo-item-05");
    await expect(element).toContainText("Structure and materials");
    await expect(element).toContainText("Not reviewed");
    await page.getByRole("button", { name: "Needs check", exact: true }).click();
    await expect(element, "selecting a draft decision must keep the active element mounted").toBeVisible({ timeout: 3000 });
    const checkNote = "Test the faucet flow and drainage in person.";
    const checkNoteField = page.getByLabel("What must be checked?");
    await checkNoteField.fill(checkNote);
    await expect(element, "typing a manual-check note must keep its review card mounted").toBeVisible();
    await expect(checkNoteField).toHaveValue(checkNote);
    const saveDecision = page.getByRole("button", { name: "Save evaluator decision", exact: true });
    await expect(saveDecision).toBeVisible({ timeout: 3000 });
    await saveDecision.click();
    await expect(element).toContainText("Evaluator: needs a human check");

    await page.getByRole("button", { name: "Sign-Off", exact: true }).click();
    await expect(page.getByTestId("inspection-result")).toHaveText("Needs review");
    await expect(page.getByText("0 of 4 room clips · 0 of 11 decisions · no result recorded", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign inspection" })).toBeDisabled();
    for (const name of [/Client-file export/, /Landlord fix-list/, /^PDF$/, /^JSON$/]) {
      await expect(page.getByRole("button", { name })).toBeDisabled();
    }
  });

  test("a deficiency needs a linked source still and full correction plan before Not Approved export", async ({ page }) => {
    test.setTimeout(120_000);
    const providerRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/(video\/segment|analyze)/.test(request.url())) providerRequests.push(request.url());
    });
    const videoBytes = await readFile(path.join(process.cwd(), "tests/fixtures/synthetic-h264-test-pattern.mp4"));

    await openApp(page);
    await setLahsaProfile(page);
    await page.getByLabel("Evaluator name").fill("Mock Evaluator");
    await goToCapture(page);
    await page.getByLabel("Upload an MP4 or MOV room video").setInputFiles({
      name: "synthetic-h264-test-pattern.mp4",
      mimeType: "video/mp4",
      buffer: videoBytes,
    });

    if (!await browserCanDecodeH264(page)) {
      await expect(page.getByRole("alert").filter({ hasText: "could not decode the selected video" })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("No video recorded for this room yet.")).toBeVisible();
      expect(providerRequests).toHaveLength(0);
      return;
    }

    await expect(page.getByText(/Clip saved on this device\./)).toBeVisible({ timeout: 20_000 });
    const stillsDisclosure = page.getByTestId("source-stills-details");
    await expect(stillsDisclosure).toHaveJSProperty("open", false);
    await expandSourceStills(page);
    await expect(page.getByRole("img", { name: /Source video frame at/ })).toHaveCount(3);
    await expect(page.getByText("1 of 4 clips saved", { exact: true })).toBeVisible();
    await uploadRequiredRoomClips(page, ["kitchen"]);
    await selectRoom(page, "kitchen");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: "View all 11 requirements", exact: true }).click();
    const overview = page.getByRole("region", { name: "All 11 inspection elements" });
    const overviewButtons = overview.locator("#element-overview-list").getByRole("button");
    const waterSupplyRow = overviewButtons.filter({ hasText: "Water supply" });
    await waterSupplyRow.click();
    const waterSupply = page.getByTestId("review-element-demo-water-supply");
    await expandReviewDisclosure(waterSupply, /Source video frames/);
    await expect(waterSupply.getByRole("img", { name: /Kitchen source frame/ })).toHaveCount(3);
    await waterSupply.getByRole("button", { name: "D · Deficient", exact: true }).click();
    await page.getByRole("button", { name: "Save evaluator decision", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Complete the in-person check and acknowledge it before saving this decision." })).toBeVisible();
    await expect(waterSupply).toContainText("Not reviewed");
    await waterSupply.getByRole("checkbox", { name: "I completed every required in-person check for this element" }).check();
    await page.getByRole("button", { name: "Save evaluator decision", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /source still|deficient area|correction|completion date/i })).toContainText(/source still|deficient area|correction|completion date/i);
    await page.getByRole("button", { name: "Back to all 11 requirements", exact: true }).click();
    await expect(waterSupplyRow).toContainText("Open");
    await waterSupplyRow.click();

    await waterSupply.getByLabel("Evaluator observation").fill("The kitchen faucet keeps dripping after shutoff.");
    await waterSupply.getByRole("group", { name: "Attach source stills to your decision" }).getByRole("checkbox").first().check();
    await waterSupply.getByLabel("Deficient area / observed issue").fill("Kitchen faucet drips after it is closed.");
    await waterSupply.getByLabel("Required correction").fill("Repair the faucet cartridge and verify that it shuts off.");
    await waterSupply.getByLabel("Completion date").fill("2026-11-02");
    await waterSupply.getByLabel("Reinspection date").fill("2026-11-05");
    await waterSupply.getByRole("checkbox", { name: "I completed every required in-person check for this element" }).check();
    await page.getByRole("button", { name: "Save evaluator decision", exact: true }).click();
    await expect(waterSupplyRow).toContainText("Deficient");

    for (let index = 0; index < await overviewButtons.count(); index += 1) {
      const button = overviewButtons.nth(index);
      if ((await button.innerText()).includes("Water supply")) continue;
      await button.click();
      const activeElement = page.locator('[data-testid^="review-element-"]');
      await markCurrentElementAcceptable(activeElement);
      await page.getByLabel("Evaluator observation").fill("I assessed this item in person in the staged unit.");
      await activeElement.getByRole("checkbox", { name: "I completed every required in-person check for this element" }).check();
      await page.getByRole("button", { name: "Save evaluator decision", exact: true }).click();
    }
    await expect(page.getByText("11 of 11 reviewed", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sign-Off", exact: true }).click();
    await page.getByLabel("Type your name to sign").fill("Mock Evaluator");
    await page.getByRole("checkbox", { name: /I evaluated this unit to the best of my ability/ }).check();
    await page.getByRole("button", { name: "Sign inspection", exact: true }).click();
    await expect(page.getByTestId("inspection-result")).toHaveText("Not Approved");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Landlord fix-list/ }).click();
    expect((await downloadPromise).suggestedFilename()).toMatch(/landlord-fix-list.*\.pdf$/);
    expect(providerRequests, "manual review and export of a local synthetic video must not call a provider").toHaveLength(0);
  });

  test("11 evaluator decisions unlock sign-off and all four local exports", async ({ page }) => {
    test.setTimeout(120_000);
    const providerRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/(video\/segment|analyze)/.test(request.url())) providerRequests.push(request.url());
    });

    await openApp(page);
    await setLahsaProfile(page);
    await page.getByLabel("Evaluator name").fill("Mock Evaluator");
    await goToCapture(page);
    await uploadRequiredRoomClips(page);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: "View all 11 requirements", exact: true }).click();

    const elementButtons = page.getByRole("region", { name: "All 11 inspection elements" }).locator("#element-overview-list").getByRole("button");
    await expect(elementButtons).toHaveCount(11);
    for (let index = 0; index < 11; index += 1) {
      await elementButtons.nth(index).click();
      const activeElement = page.locator('[data-testid^="review-element-"]');
      await expect(activeElement).toBeVisible();
      await markCurrentElementAcceptable(activeElement);
      await page.getByLabel("Evaluator observation").fill("I assessed this item in person in the staged unit.");
      await activeElement.getByRole("checkbox", { name: "I completed every required in-person check for this element" }).check();
      await page.getByRole("button", { name: "Save evaluator decision", exact: true }).click();
      await expect(page.getByText(`${index + 1} of 11 reviewed`, { exact: true })).toBeVisible();
    }

    await page.getByRole("button", { name: "Sign-Off", exact: true }).click();
    await page.getByLabel("Type your name to sign").fill("Mock Evaluator");
    await page.getByRole("checkbox", { name: /I evaluated this unit to the best of my ability/ }).check();
    const signInspection = page.getByRole("button", { name: "Sign inspection", exact: true });
    await expect(signInspection).toBeEnabled();
    await signInspection.click();
    await expect(page.getByTestId("inspection-result")).toHaveText("Approved");
    await expect(page.getByText(/Evaluator sign-off saved to this device/)).toBeVisible();

    const exports = [
      { name: /Client-file export/, suffix: /client-file.*\.pdf$/ },
      { name: /Landlord fix-list/, suffix: /landlord-fix-list.*\.pdf$/ },
      { name: /^PDF$/, suffix: /hmis-ready.*\.pdf$/ },
      { name: /^JSON$/, suffix: /hmis-ready.*\.json$/ },
    ];
    for (const item of exports) {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: item.name }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(item.suffix);
    }
    expect(providerRequests, "review, sign-off, and local export must not call a provider").toHaveLength(0);
  });
});
