import { describe, expect, it } from "vitest";
import {
  callMetaDraft,
  callMetaGuide,
  resolveMetaConfig,
  requireLiveConfig,
} from "../../../../src/server/meta/adapter";

const config = resolveMetaConfig({
  APP_ANALYSIS_MODE: "live",
  META_API_KEY: "server-only-test-key",
});
requireLiveConfig(config);

describe("Meta adapter response bounds", () => {
  it("rejects oversized streamed draft and guide responses without exposing their bodies", async () => {
    const privateProviderBody = `private-provider-response-${"x".repeat(64 * 1024)}`;
    const fetchImpl: typeof fetch = async () => new Response(privateProviderBody, { status: 200 });

    await expect(callMetaDraft({
      config,
      itemLabel: "Kitchen sink",
      captureGuidance: "Stand back.",
      imageMime: "image/png",
      imageBase64: "aGVsbG8=",
      fetchImpl,
    })).rejects.toMatchObject({ code: "INVALID_MODEL_OUTPUT", status: 502 });

    await expect(callMetaGuide({
      config,
      action: "next",
      stage: "start",
      itemLabel: "Kitchen sink",
      captureGuidance: "Stand back.",
      manualCheck: "Run the faucet.",
      fetchImpl,
    })).rejects.toMatchObject({ code: "INVALID_MODEL_OUTPUT", status: 502 });

    try {
      await callMetaDraft({
        config,
        itemLabel: "Kitchen sink",
        captureGuidance: "Stand back.",
        imageMime: "image/png",
        imageBase64: "aGVsbG8=",
        fetchImpl,
      });
      expect.unreachable("expected bounded response rejection");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("private-provider-response");
      expect(String((error as Error).message)).not.toContain("server-only-test-key");
    }
  });
});
