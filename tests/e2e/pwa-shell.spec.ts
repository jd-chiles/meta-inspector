/** Static shell asset checks for the current Move-in Ready app. */
import { test, expect } from "@playwright/test";

test("manifest identifies the installable Move-in Ready app and serves its icons", async ({ page }) => {
  const response = await page.request.get("/");
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain('rel="manifest"');

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as {
    name?: string;
    description?: string;
    display?: string;
    icons?: Array<{ src?: string; sizes?: string }>;
  };
  expect(manifest.name).toBe("Habitability Walkthrough Companion");
  expect(manifest.description).toContain("Mobile-first LAHSA Form 1083 walkthrough companion");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons?.some((icon) => icon.sizes === "192x192")).toBe(true);
  expect(manifest.icons?.some((icon) => icon.sizes === "512x512")).toBe(true);
  for (const icon of manifest.icons ?? []) {
    expect(icon.src).toBeTruthy();
    expect((await page.request.get(icon.src as string)).ok()).toBe(true);
  }
});

test("service worker caches only the app shell and never intercepts media writes", async ({ page }) => {
  const response = await page.request.get("/sw.js");
  expect(response.ok()).toBe(true);
  const source = await response.text();
  expect(source).toContain("SHELL_CACHE");
  expect(source).toContain('var APP_CACHE_PREFIX = "habitability-walkthrough-";');
  expect(source).toContain("name.indexOf(APP_CACHE_PREFIX) === 0 && name !== SHELL_CACHE");
  expect(source).toContain('"/manifest.webmanifest"');
  expect(source).toContain("/api/");
  expect(source).toContain("GET");
});
