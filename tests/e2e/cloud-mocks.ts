import { createHash } from "node:crypto";
import { expect, type Page } from "@playwright/test";

import { goToCapture } from "./navigation";

type IdentitySeed = {
  sessionId: string;
  schemaVersion: number;
  videoId: string;
  videoRevision: number;
  analysisId: string;
  attempt: number;
  catalogVersion: string;
};

type MockJob = {
  jobId: string;
  room: string;
  identity: IdentitySeed & { expectedVideoSha256?: string };
  contentType: "video/mp4" | "video/quicktime";
  contentLength: number;
  bytes?: Buffer;
  status: string;
};
const requestLogByPage = new WeakMap<Page, string[]>();
const browserErrorsByPage = new WeakMap<Page, string[]>();

/** API doubles keep the browser contract real without cloud credentials. */
export async function installCloudMocks(page: Page): Promise<{
  inspections: Map<string, Record<string, unknown>>;
  jobs: Map<string, MockJob>;
  requests: string[];
  setOffline: () => Promise<void>;
}> {
  const inspections = new Map<string, Record<string, unknown>>();
  const revisions = new Map<string, number>();
  const jobs = new Map<string, MockJob>();
  const requests: string[] = [];
  requestLogByPage.set(page, requests);
  const browserErrors: string[] = [];
  browserErrorsByPage.set(page, browserErrors);
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  let nextJob = 1;
  let offlineMode = false;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/inspections/") || url.pathname.startsWith("/api/video/jobs")) {
      requests.push(`network ${request.method()} ${url.pathname}`);
    }
  });

  await page.route("**/api/inspections/**", async (route) => {
    const request = route.request();
    if (offlineMode) return void await route.abort("internetdisconnected");
    const sessionId = decodeURIComponent(new URL(request.url()).pathname.split("/").at(-1) ?? "");
    requests.push(`${request.method()} /api/inspections/${sessionId}`);
    if (request.method() === "GET") {
      await route.fulfill({ json: { inspection: inspections.get(sessionId) ?? null, revision: revisions.get(sessionId) ?? 0 } });
      return;
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as { inspection?: Record<string, unknown>; expectedRevision?: number } | null;
      if (!body?.inspection || body.expectedRevision !== (revisions.get(sessionId) ?? 0)) {
        await route.fulfill({ status: 409, json: { error: { message: "stale mock revision" } } });
        return;
      }
      inspections.set(sessionId, body.inspection);
      const revision = (revisions.get(sessionId) ?? 0) + 1;
      revisions.set(sessionId, revision);
      await route.fulfill({ json: { ok: true, revision } });
      return;
    }
    if (request.method() === "DELETE") {
      inspections.delete(sessionId);
      revisions.delete(sessionId);
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ status: 405, json: { error: { message: "method not allowed" } } });
  });

  await page.route("**/api/video/jobs**", async (route) => {
    const request = route.request();
    if (offlineMode) return void await route.abort("internetdisconnected");
    const url = new URL(request.url());
    const path = url.pathname;
    requests.push(`${request.method()} ${path}`);
    if (path === "/api/video/jobs" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        room: string; identity: IdentitySeed; media: { contentType: MockJob["contentType"]; contentLength: number };
      };
      const jobId = `mock-job-${nextJob++}`;
      jobs.set(jobId, {
        jobId, room: body.room, identity: body.identity, contentType: body.media.contentType,
        contentLength: body.media.contentLength, status: "upload_pending",
      });
      await route.fulfill({
        status: 201,
        json: {
          ok: true, jobId, status: "upload_pending", identity: body.identity,
          upload: {
            url: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/mock-upload",
            method: "PUT", headers: { "content-type": body.media.contentType },
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      });
      return;
    }

    const match = /^\/api\/video\/jobs\/([^/]+)(?:\/(complete|process))?$/.exec(path);
    const job = match ? jobs.get(decodeURIComponent(match[1]!)) : undefined;
    if (!match || !job) {
      await route.fulfill({ status: 404, json: { error: { message: "job missing" } } });
      return;
    }
    const action = match[2] ?? "status";
    if (action === "complete" && request.method() === "POST") {
      if (!job.bytes) {
        await route.fulfill({ status: 409, json: { error: { message: "upload missing" } } });
        return;
      }
      const sha256 = createHash("sha256").update(job.bytes).digest("hex");
      job.identity.expectedVideoSha256 = sha256;
      job.status = "ready";
      await route.fulfill({ json: snapshot(job, sha256) });
      return;
    }
    if (action === "process" && request.method() === "POST") {
      job.status = "queued";
      await route.fulfill({ json: snapshot(job) });
      return;
    }
    if (action === "status" && request.method() === "GET") {
      await route.fulfill({ json: snapshot(job) });
      return;
    }
    if (request.method() === "DELETE") {
      job.status = "deleted";
      await route.fulfill({ json: { ok: true, cleanupPending: false } });
      return;
    }
    await route.fulfill({ status: 405, json: { error: { message: "method not allowed" } } });
  });

  await page.route("https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/**", async (route) => {
    const request = route.request();
    if (offlineMode) return void await route.abort("internetdisconnected");
    const cors = {
      "access-control-allow-origin": request.headers().origin ?? "*",
      "access-control-allow-methods": "GET, PUT, OPTIONS",
      "access-control-allow-headers": "content-type",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (request.method() === "GET") {
      requests.push("GET /r2/video");
      const job = [...jobs.values()].find((candidate) => candidate.bytes);
      if (!job?.bytes) {
        await route.fulfill({ status: 404, headers: cors });
        return;
      }
      await route.fulfill({ status: 200, headers: cors, contentType: job.contentType, body: job.bytes });
      return;
    }
    if (request.method() !== "PUT") {
      await route.fulfill({ status: 405, headers: cors });
      return;
    }
    const bytes = request.postDataBuffer() ?? Buffer.alloc(0);
    requests.push("PUT /r2/video");
    const job = [...jobs.values()].find((candidate) => candidate.status === "upload_pending" && candidate.contentLength === bytes.length);
    if (!job) return void await route.fulfill({ status: 409, headers: cors });
    job.bytes = bytes;
    await route.fulfill({ status: 200, headers: cors });
  });

  return {
    inspections,
    jobs,
    requests,
    async setOffline() {
      offlineMode = true;
      await page.context().setOffline(true);
    },
  };
}

function snapshot(job: MockJob, sha256 = job.identity.expectedVideoSha256) {
  const identity = sha256 ? { ...job.identity, expectedVideoSha256: sha256 } : job.identity;
  return {
    ok: true, jobId: job.jobId, status: job.status, identity,
    ...(sha256 ? {
      sourceUrl: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/mock-download",
      media: {
        contentType: job.contentType, contentLength: job.contentLength, sha256,
        durationMs: 4_000, durationSeconds: 4, width: 320, height: 180,
        capturedAt: new Date().toISOString(),
      },
    } : {}),
  };
}

export async function configureMockUnit(page: Page, expectedMode = "Sample only", initialUrl = "/"): Promise<void> {
  await page.goto(initialUrl);
  const app = page.getByTestId("move-in-ready-app");
  try {
    await expect(app).toBeVisible();
  } catch (error) {
    const status = await page.locator("main").innerText().catch(() => "no main content");
    throw new Error(`${String(error)}\nApp status: ${status}\nAPI requests: ${JSON.stringify(requestLogByPage.get(page) ?? [])}\nBrowser errors: ${JSON.stringify(browserErrorsByPage.get(page) ?? [])}`);
  }
  await expect(page.getByTestId("analysis-mode")).toHaveText(expectedMode);
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  const setup = page.getByRole("button", { name: "Unit & Funding", exact: true });
  if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
  await page.getByLabel("Unit pseudonym").fill("Staged Cloud Test Unit 04");
  await page.getByLabel("Funding type").selectOption("lahsa");
  await page.getByLabel("Unit type").selectOption("studio");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).click();
  await goToCapture(page);
}
