import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createUnreviewedEvaluatorDecisions,
  MOVE_IN_READY_ELEMENT_IDS,
  MOVE_IN_READY_SCHEMA_VERSION,
  roomsForUnit,
  type EvaluatorDecisionSet,
  type EvidenceReference,
} from "../../../src/domain/move-in-ready";
import {
  buildMoveInReadyPdf,
  exportFilename,
  type MoveInReadyExportInput,
} from "../../../src/export/move-in-ready-pdf";

const SIGNED_AT = "2026-10-29T09:15:00.000Z";
const nativeFetch = globalThis.fetch;

// Spanish diacritics resolve through the bundled DejaVu fonts, which the
// exporter loads with fetch. Serve those file URLs from disk in Node.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = String(request);
    if (url.startsWith("file://") && (url.endsWith(".ttf") || url.endsWith(".woff2"))) {
      return new Response(new Uint8Array(await readFile(fileURLToPath(url))), { status: 200 });
    }
    return nativeFetch(request, init);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// A synthetic 8x8 JPEG used only to exercise PDF image embedding.
const SYNTHETIC_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzU5LjM3LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z";
const SYNTHETIC_JPEG = new Uint8Array(Buffer.from(SYNTHETIC_JPEG_BASE64, "base64"));

const EVIDENCE: EvidenceReference = {
  schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
  catalogVersion: "0.3.0-demo.3",
  videoId: "video-demo-kitchen",
  videoRevision: 1,
  roomId: "kitchen",
  stillId: "still-demo-kitchen-12000",
  frameIndex: null,
  timestampMs: 12_000,
  stillHash: createHash("sha256").update(SYNTHETIC_JPEG).digest("hex"),
};

function approvedDecisions(): EvaluatorDecisionSet {
  const decisions = createUnreviewedEvaluatorDecisions();
  for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
    decisions[elementId] = {
      status: "A",
      evaluatorName: "Demo Evaluator",
      decidedAt: SIGNED_AT,
      inPersonCheckAcknowledgment: {
        evaluatorName: "Demo Evaluator",
        completedAt: SIGNED_AT,
      },
      rationale: "Checked in person in the staged unit.",
      evidence: [],
      analysisIdentity: null,
      ...(elementId === "demo-smoke-co"
        ? { fireSafetyAssessment: { unitDetectors: "A" as const, publicAreaDetectors: "A" as const } }
        : {}),
    };
  }
  return decisions;
}

function inputFor(overrides: Partial<MoveInReadyExportInput> = {}): MoveInReadyExportInput {
  return {
    sessionId: "demo-session-001",
    pseudonym: "Sample Unit 12",
    fundingType: "lahsa",
    capturedRoomIds: roomsForUnit("1-bedroom", 1),
    expectedRoomIds: roomsForUnit("1-bedroom", 1),
    decisions: approvedDecisions(),
    signoff: {
      evaluatorName: "Demo Evaluator",
      typedSignature: "Demo Evaluator",
      attested: true,
      signedAt: SIGNED_AT,
    },
    participantSignoff: {
      participantName: "Demo Participant",
      typedSignature: "Demo Participant",
      attested: true,
      signedAt: SIGNED_AT,
    },
    evaluatorAgencyName: "Demo Agency",
    landlordDiscussion: "no",
    generatedAt: SIGNED_AT,
    stills: [],
    ...overrides,
  };
}

function withConfirmedDeficiency(): MoveInReadyExportInput {
  const evidence = { ...EVIDENCE };
  const decisions = approvedDecisions();
  decisions["demo-water-supply"] = {
    status: "D",
    evaluatorName: "Demo Evaluator",
    decidedAt: SIGNED_AT,
    inPersonCheckAcknowledgment: {
      evaluatorName: "Demo Evaluator",
      completedAt: SIGNED_AT,
    },
    rationale: "The faucet continues to drip after it is closed.",
    evidence: [evidence],
    analysisIdentity: null,
    deficiency: {
      issueDescription: "Kitchen faucet drips when closed.",
      correction: "Repair the faucet cartridge and verify that it shuts off.",
      completionDate: "2026-11-02",
      reinspectionDate: "2026-11-05",
    },
  };
  return inputFor({
    decisions,
    stills: [{ evidence, jpegBytes: new Uint8Array(SYNTHETIC_JPEG) }],
  });
}

function inflatedPdfStreams(bytes: Uint8Array): string[] {
  const binary = Buffer.from(bytes).toString("latin1");
  const streams: string[] = [];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(binary)) !== null) {
    try {
      streams.push(inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"));
    } catch {
      // Ignore non-Flate streams, such as the embedded JPEG image bytes.
    }
  }
  return streams;
}

function decodedPdfStreams(bytes: Uint8Array): string {
  return inflatedPdfStreams(bytes)
    .flatMap((stream) =>
      [...stream.matchAll(/<([0-9a-f]+)>\s*Tj/gi)].map((match) => Buffer.from(match[1], "hex").toString("latin1")),
    )
    .join(" ");
}

describe("landlord fix-list languages", () => {
  it("renders the English fix list with the plain-language header and agency name", async () => {
    const bytes = await buildMoveInReadyPdf(withConfirmedDeficiency(), "landlord-fix-list", "en");
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
    const text = decodedPdfStreams(bytes);
    expect(text).toContain("Landlord fix list");
    expect(text).toContain("This document lists the habitability items the evaluator found deficient");
    expect(text).toContain("Each item must be corrected by its completion date.");
    expect(text).toContain("A re-inspection will verify that each correction is complete.");
    expect(text).toContain("Agency: Demo Agency");
    expect(text).toContain("Water supply");
    expect(text).toContain("Observed issue:");
    expect(text).toContain("Kitchen faucet drips when closed.");
    expect(text).toContain("Correction:");
    expect(text).toContain("Completion date: 2026-11-02");
    expect(text).toContain("Reinspection date: 2026-11-05");
  });

  it("renders the Spanish fix list from the static string table, with recorded content verbatim", async () => {
    const bytes = await buildMoveInReadyPdf(withConfirmedDeficiency(), "landlord-fix-list", "es");
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
    const text = decodedPdfStreams(bytes);
    expect(text).toContain("Lista de reparaciones para el propietario");
    expect(text).toContain("Este documento enumera los elementos de habitabilidad");
    expect(text).toContain("Cada elemento debe corregirse antes de su fecha de finalización.");
    expect(text).toContain("Una nueva inspección verificará que cada corrección esté completa.");
    expect(text).toContain("Agencia: Demo Agency");
    expect(text).toContain("Problema observado:");
    expect(text).toContain("Kitchen faucet drips when closed.");
    expect(text).toContain("Corrección requerida:");
    expect(text).toContain("Fecha de finalización: 2026-11-02");
    expect(text).toContain("Fecha de nueva inspección: 2026-11-05");
    // Boilerplate is translated; English labels must not leak into the ES copy.
    expect(text).not.toContain("Observed issue:");
    expect(text).not.toContain("Completion date:");
    expect(text).not.toContain("Each item must be corrected");
  });

  it("defaults the fix list to English and leaves other kinds untranslated", async () => {
    const input = withConfirmedDeficiency();
    const defaulted = decodedPdfStreams(await buildMoveInReadyPdf(input, "landlord-fix-list"));
    expect(defaulted).toContain("Landlord fix list");
    const clientFile = decodedPdfStreams(await buildMoveInReadyPdf(input, "client-file", "es"));
    expect(clientFile).toContain("Client-file inspection copy");
    expect(clientFile).not.toContain("Lista de reparaciones");
  });

  it("renders hostile decision text as inert literal text with control characters stripped", async () => {
    const input = withConfirmedDeficiency();
    const water = input.decisions["demo-water-supply"];
    if (water.status !== "D") throw new Error("Test setup requires a D decision.");
    water.deficiency.issueDescription = "Faucet leaks <script>alert(\"xss\")</script> \u0000\u202acheck.";
    water.rationale = "Observed <img src=x onerror=alert(1)> in person.";
    const bytes = await buildMoveInReadyPdf(input, "landlord-fix-list", "en");
    // The document must stay well-formed: hostile text cannot break the PDF.
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
    const text = decodedPdfStreams(bytes);
    // Markup-like content round-trips as inert literal text (a PDF text run
    // carries no markup semantics), never interpreted or executed.
    expect(text).toContain("<script>");
    expect(text).toContain("onerror=alert(1)");
    // Control characters and bidi overrides are stripped by the cleaner.
    expect(text).not.toMatch(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/);
  });

  it("names the Spanish fix list distinctly without inventing landlord contact fields", () => {
    const generatedAt = "2026-11-03T00:00:00.000Z";
    expect(exportFilename("landlord-fix-list", "demo-session-001", generatedAt, "es"))
      .toMatch(/^walkthrough-kit-landlord-fix-list-es-demo-session-001-.*\.pdf$/);
    expect(exportFilename("landlord-fix-list", "demo-session-001", generatedAt))
      .toMatch(/^walkthrough-kit-landlord-fix-list-demo-session-001-.*\.pdf$/);
    expect(exportFilename("landlord-fix-list", "demo-session-001", generatedAt, "en"))
      .not.toContain("-es-");
  });
});
