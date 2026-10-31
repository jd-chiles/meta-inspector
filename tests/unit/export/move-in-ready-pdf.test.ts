import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createUnreviewedEvaluatorDecisions,
  EVALUATOR_ATTESTATION_TEXT,
  MOVE_IN_READY_ELEMENTS,
  MOVE_IN_READY_ELEMENT_IDS,
  MOVE_IN_READY_ROOMS,
  MOVE_IN_READY_SCHEMA_VERSION,
  type EvidenceReference,
  type EvaluatorDecisionSet,
} from "../../../src/domain/move-in-ready";
import {
  buildHmisReadyJson,
  buildMoveInReadyExportSet,
  MOVE_IN_READY_EXPORT_NOTICE,
  type MoveInReadyExportInput,
} from "../../../src/export/move-in-ready-pdf";

const SIGNED_AT = "2026-10-29T09:15:00.000Z";
const OFFICIAL_FORM_URL = "/forms/lahsa-form-1083-fy-2022-2023.pdf";
const nativeFetch = globalThis.fetch;
let officialFormFixture = new Uint8Array();

beforeEach(async () => {
  officialFormFixture = new Uint8Array(await readFile(new URL("../../../public/forms/lahsa-form-1083-fy-2022-2023.pdf", import.meta.url)));
  vi.stubGlobal("fetch", vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    if (String(request) === OFFICIAL_FORM_URL) {
      return new Response(new Uint8Array(officialFormFixture), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
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

function syntheticJpeg(): Uint8Array {
  return new Uint8Array(SYNTHETIC_JPEG);
}

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

function inputFor(
  overrides: Partial<MoveInReadyExportInput> = {},
): MoveInReadyExportInput {
  return {
    sessionId: "demo-session-001",
    pseudonym: "Sample Unit 12",
    fundingType: "lahsa",
    capturedRoomIds: MOVE_IN_READY_ROOMS.map((room) => room.id),
    decisions: approvedDecisions(),
    signoff: {
      evaluatorName: "Demo Evaluator",
      typedSignature: "Demo Evaluator",
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

function withConfirmedDeficiency(jpegBytes = syntheticJpeg()): MoveInReadyExportInput {
  const evidence = {
    ...EVIDENCE,
    stillHash: createHash("sha256").update(jpegBytes).digest("hex"),
  };
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
    stills: [{ evidence, jpegBytes }],
  });
}

function withAnalysisProvenance(): MoveInReadyExportInput {
  const input = withConfirmedDeficiency();
  const water = input.decisions["demo-water-supply"];
  if (water.status !== "D") throw new Error("Test setup requires a D decision.");
  const evidence = { ...EVIDENCE, frameIndex: 42 };
  const analysisIdentity = {
    sessionId: input.sessionId,
    roomId: "kitchen" as const,
    schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
    videoId: EVIDENCE.videoId,
    videoRevision: EVIDENCE.videoRevision,
    expectedSourceHash: "b".repeat(64),
    analysisId: "analysis-demo-001",
    attempt: 2,
    catalogVersion: "0.3.0-demo.3",
  };
  water.evidence = [evidence];
  water.analysisIdentity = analysisIdentity;
  input.stills = [{ evidence, jpegBytes: syntheticJpeg() }];
  return input;
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

function decodedPdfTextRuns(bytes: Uint8Array): string[] {
  return inflatedPdfStreams(bytes).flatMap((stream) =>
    [...stream.matchAll(/<([0-9a-f]+)>\s*Tj/gi)].map((match) => Buffer.from(match[1], "hex").toString("latin1")),
  );
}

function decodedPdfStreams(bytes: Uint8Array): string {
  return decodedPdfTextRuns(bytes).join(" ");
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

describe("Move-in Ready signed export PDFs", () => {
  it("keeps the official Form 1083 row and note widgets aligned with its 11a/11b sections", async () => {
    expect(createHash("sha256").update(officialFormFixture).digest("hex")).toBe(
      "9c9faf9039d98aa570017f6bf22bafd5a999c1ba3f25a8f8bee3241546602261",
    );
    const source = await PDFDocument.load(officialFormFixture);
    const form = source.getForm();
    expect(source.getPages()).toHaveLength(3);

    const statusFields = [
      "Approved or DeficientRow1",
      "Approved or DeficientRow2",
      "Approved or DeficientRow3",
      "Approved or DeficientRow4",
    ];
    const statusWidgetCount = statusFields.reduce(
      (count, name) => count + form.getTextField(name).acroField.getWidgets().length,
      0,
    );
    expect(statusWidgetCount).toBe(MOVE_IN_READY_ELEMENTS.length + 1);
    expect(form.getTextField("Approved or DeficientRow4").acroField.getWidgets()).toHaveLength(9);

    const expectedNotes = [
      "Notes1 Structure and materials",
      "Notes2 Access",
      "Notes3 Space and security",
      "Notes4 Interior air quality",
      "5 Water Supply",
      "6 Sanitary Facilities",
      "7 Thermal environment",
      "8 Lighting and electricity",
      "9 Food preparation and refuse disposal",
      "10 Sanitary condition",
      "11 a. Fire safety",
      "11 b The public areas",
    ];
    const sourceFieldNames = form.getFields().map((field) => field.getName());
    for (const prefix of expectedNotes) {
      expect(sourceFieldNames.filter((name) => name.startsWith(prefix))).toHaveLength(1);
    }

    const firstStatusWidgets = statusFields.slice(0, 3)
      .map((name) => form.getTextField(name).acroField.getWidgets()[0]!);
    const repeatedStatusWidgets = form.getTextField("Approved or DeficientRow4").acroField.getWidgets();
    const widgetLocation = (widget: (typeof firstStatusWidgets)[number]) => {
      const pageRef = widget.P();
      const page = pageRef
        ? source.getPages().findIndex((candidate) => candidate.ref.toString() === pageRef.toString())
        : -1;
      const rectangle = widget.getRectangle();
      return { page, centerY: rectangle.y + rectangle.height / 2 };
    };
    const orderedStatusWidgets = [
      ...firstStatusWidgets,
      ...repeatedStatusWidgets
        .sort((left, right) => {
          const a = widgetLocation(left);
          const b = widgetLocation(right);
          return a.page - b.page || b.centerY - a.centerY;
        }),
    ];
    const orderedNoteWidgets = expectedNotes.map((prefix) => {
      const name = sourceFieldNames.find((candidate) => candidate.startsWith(prefix));
      if (!name) throw new Error(`Missing official notes field: ${prefix}`);
      return form.getTextField(name).acroField.getWidgets()[0]!;
    });
    for (const [index, statusWidget] of orderedStatusWidgets.entries()) {
      const statusLocation = widgetLocation(statusWidget);
      const noteLocation = widgetLocation(orderedNoteWidgets[index]!);
      expect(statusLocation.page, `Status widget ${index + 1} should match its official notes row`)
        .toBe(noteLocation.page);
      expect(Math.abs(statusLocation.centerY - noteLocation.centerY), `Status widget ${index + 1} should align with its official notes row`)
        .toBeLessThan(6);
    }

    const fireSafetyFields = sourceFieldNames.filter((name) => name.startsWith("11 "));
    expect(fireSafetyFields.some((name) => name.startsWith("11 a. Fire safety"))).toBe(true);
    expect(fireSafetyFields.some((name) => name.startsWith("11 b The public areas"))).toBe(true);
    expect(form.getTextField("Date").acroField.getWidgets()).toHaveLength(2);
  });

  it.each([
    ["unknown funding", { fundingType: "unknown" as const }],
    ["HUD funding", { fundingType: "hud" as const }],
    ["missing attestation", { signoff: { ...inputFor().signoff, attested: false } }],
    ["unmatched signature", { signoff: { ...inputFor().signoff, typedSignature: "Different Name" } }],
  ])("fails closed for %s", async (_caseName, override) => {
    await expect(buildHmisReadyJson(inputFor(override))).rejects.toThrow();
  });

  it("rejects export when the signer differs from the evaluator recorded on decisions", async () => {
    await expect(buildMoveInReadyExportSet(inputFor({
      signoff: {
        evaluatorName: "Jordan Lee",
        typedSignature: "Jordan Lee",
        attested: true,
        signedAt: SIGNED_AT,
      },
    }))).rejects.toThrow();
  });

  it.each([
    ["missing evaluator agency", { evaluatorAgencyName: "" }],
    ["missing landlord discussion choice", { landlordDiscussion: undefined }],
    ["missing landlord discussion date", { landlordDiscussion: "yes" as const, landlordDiscussionDate: "" }],
    ["invalid landlord discussion date", { landlordDiscussion: "yes" as const, landlordDiscussionDate: "2026-02-30" }],
  ])("requires Form 1083 administrative data: %s", async (_caseName, override) => {
    await expect(buildHmisReadyJson(inputFor(override))).rejects.toThrow();
  });

  it.each([
    ["signature", { leadershipSignoff: "" }, /leadership sign-off is required/i],
    ["name and title", { leadershipNameAndTitle: "" }, /leadership name and title are required/i],
    ["date", { leadershipSignedAt: "" }, /leadership sign-off date is required/i],
    ["valid date", { leadershipSignedAt: "2026-02-30" }, /leadership sign-off date is required/i],
  ] as const)("requires agency leadership %s when the policy gate is enabled", async (_caseName, override, message) => {
    await expect(buildHmisReadyJson(inputFor({
      leadershipSignoffRequired: true,
      leadershipSignoff: "Agency Director",
      leadershipNameAndTitle: "Jordan Lee, Program Director",
      leadershipSignedAt: "2026-10-29",
      ...override,
    }))).rejects.toThrow(message);
  });

  it("fails closed when a required room video is missing", async () => {
    await expect(buildHmisReadyJson(inputFor({
      capturedRoomIds: ["kitchen", "bathroom", "bedroom-living"],
    }))).rejects.toThrow(/every required room video must be captured/i);
  });

  it("fails closed until every element has a completed evaluator decision", async () => {
    const decisions = approvedDecisions();
    decisions["demo-item-11"] = {
      status: "needs-human-check",
      note: "The detector needs an in-person check.",
    };

    await expect(buildHmisReadyJson(inputFor({ decisions }))).rejects.toThrow(
      /valid evaluator decision and sign-off/i,
    );
  });

  it("derives the result from evaluator decisions even when extra model proposals disagree", async () => {
    const allHumanApproved = {
      ...inputFor(),
      modelProposals: [
        {
          elementId: "demo-water-supply",
          suggestion: "D",
          observation: "Unreviewed model-only proposal.",
          confidence: 99,
        },
      ],
    } as MoveInReadyExportInput;
    expect((await buildHmisReadyJson(allHumanApproved)).result).toBe("approved");

    const oneHumanDeficiency = {
      ...withConfirmedDeficiency(),
      modelProposals: [
        {
          elementId: "demo-water-supply",
          suggestion: "A",
          observation: "A contradictory model-only proposal.",
          confidence: 99,
        },
      ],
    } as MoveInReadyExportInput;
    expect((await buildHmisReadyJson(oneHumanDeficiency)).result).toBe("not-approved");
  });

  it("rejects a same-ID still whose full video identity does not match the evaluator reference", async () => {
    const input = withConfirmedDeficiency();
    input.stills = [{
      evidence: { ...EVIDENCE, videoRevision: EVIDENCE.videoRevision + 1 },
      jpegBytes: syntheticJpeg(),
    }];

    await expect(buildMoveInReadyExportSet(input)).rejects.toThrow(/full evidence identity/i);
  });

  it("rejects evidence whose source frame index differs even when its still ID and bytes match", async () => {
    const input = withConfirmedDeficiency();
    input.stills = [{
      evidence: { ...EVIDENCE, frameIndex: 42 },
      jpegBytes: syntheticJpeg(),
    }];

    await expect(buildMoveInReadyExportSet(input)).rejects.toThrow(/full evidence identity/i);
  });

  it("rejects bytes whose digest does not match the cited still hash", async () => {
    const input = withConfirmedDeficiency();
    const changedBytes = syntheticJpeg();
    changedBytes[changedBytes.length - 1] ^= 0xff;
    input.stills = [{ evidence: EVIDENCE, jpegBytes: changedBytes }];

    await expect(buildMoveInReadyExportSet(input)).rejects.toThrow(/SHA-256 evidence hash/i);
  });

  it("fails export rather than returning a PDF when JPEG embedding rejects the cited still", async () => {
    const malformedJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);

    await expect(buildMoveInReadyExportSet(withConfirmedDeficiency(malformedJpeg))).rejects.toThrow();
  });

  it("embeds every cited still when a decision spans multiple evidence rows", async () => {
    const input = withConfirmedDeficiency();
    const evidence = Array.from({ length: 5 }, (_, index) => ({
      ...EVIDENCE,
      stillId: `still-demo-kitchen-${index + 1}`,
      timestampMs: 12_000 + index * 1_000,
    }));
    const decision = input.decisions["demo-water-supply"];
    if (decision.status !== "D") throw new Error("Test setup requires a D decision.");
    decision.evidence = evidence;
    input.stills = evidence.map((reference) => ({ evidence: reference, jpegBytes: syntheticJpeg() }));

    const exports = await buildMoveInReadyExportSet(input);
    const imageObjects = Buffer.from(exports.landlordFixListPdf).toString("latin1").match(/\/Subtype \/Image\b/g) ?? [];

    expect(exports.json.elements.find((element) => element.id === "demo-water-supply")?.evidence).toHaveLength(5);
    expect(exports.json.elements.find((element) => element.id === "demo-water-supply")?.evidence[0]).toMatchObject({
      schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
      catalogVersion: EVIDENCE.catalogVersion,
    });
    expect(imageObjects).toHaveLength(5);
    expect((await PDFDocument.load(exports.landlordFixListPdf)).getPages().length).toBeGreaterThan(0);
  });

  it("puts only evaluator-confirmed D items in the landlord fix list", async () => {
    const input = withConfirmedDeficiency();
    input.decisions["demo-item-11"] = {
      status: "A",
      evaluatorName: "Demo Evaluator",
      decidedAt: SIGNED_AT,
      inPersonCheckAcknowledgment: {
        evaluatorName: "Demo Evaluator",
        completedAt: SIGNED_AT,
      },
      rationale: "The detector passed the in-person check.",
      evidence: [],
      analysisIdentity: null,
    };
    const withDraftOnlyDeficiency = {
      ...input,
      modelProposals: [
        {
          elementId: "demo-item-11",
          suggestion: "D",
          observation: "Draft-only observation must not enter the fix list.",
          confidence: 96,
        },
      ],
    } as MoveInReadyExportInput;

    const exports = await buildMoveInReadyExportSet(withDraftOnlyDeficiency);
    const landlordText = decodedPdfStreams(exports.landlordFixListPdf);

    expect(landlordText).toContain("Water supply");
    expect(landlordText).toContain("Kitchen faucet drips when closed.");
    expect(landlordText).not.toContain("Fire safety");
    expect(landlordText).not.toContain("Draft-only observation");
  });

  it("labels companion JSON as a local/manual draft and omits AI proposal content", async () => {
    const input = {
      ...withConfirmedDeficiency(),
      modelProposals: [
        {
          elementId: "demo-water-supply",
          suggestion: "A",
          observation: "MODEL-ONLY TEXT MUST NOT BE EXPORTED",
          confidence: 99,
        },
      ],
    } as MoveInReadyExportInput;

    const exports = await buildMoveInReadyExportSet(input);
    const serializedJson = new TextDecoder().decode(exports.hmisReadyJson);
    const json = JSON.parse(serializedJson) as Record<string, unknown>;

    expect(json.schema).toBe("move-in-ready-hmis-draft-v2");
    expect(json.notice).toBe(MOVE_IN_READY_EXPORT_NOTICE);
    expect((json.evaluator as { attestationText?: string }).attestationText).toBe(EVALUATOR_ATTESTATION_TEXT);
    expect(json.evaluator).toMatchObject({ agencyName: "Demo Agency" });
    expect(json.form1083).toMatchObject({
      landlordDiscussion: "no",
      landlordDiscussionDate: null,
      fireSafetyAssessment: {
        unitDetectors: "A",
        publicAreaDetectors: "A",
      },
    });
    expect(String(json.notice)).toMatch(/local draft.*manual/i);
    expect(String(json.notice)).toMatch(/does not submit to HMIS/i);
    expect(serializedJson).not.toContain("MODEL-ONLY TEXT MUST NOT BE EXPORTED");
    expect(serializedJson).not.toContain("modelProposals");
    expect(json).not.toHaveProperty("proposals");
  });

  it("preserves evaluator, analysis, and full source-frame identity in HMIS JSON", async () => {
    const input = withAnalysisProvenance();
    const json = await buildHmisReadyJson(input);
    const water = json.elements.find((element) => element.id === "demo-water-supply");

    expect(water).toMatchObject({
      evaluatorName: "Demo Evaluator",
      decidedAt: SIGNED_AT,
      inPersonCheckAcknowledgment: {
        evaluatorName: "Demo Evaluator",
        completedAt: SIGNED_AT,
      },
      analysisIdentity: {
        sessionId: "demo-session-001",
        roomId: "kitchen",
        schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
        videoId: "video-demo-kitchen",
        videoRevision: 1,
        expectedSourceHash: "b".repeat(64),
        analysisId: "analysis-demo-001",
        attempt: 2,
        catalogVersion: "0.3.0-demo.3",
      },
      evidence: [{
        videoId: "video-demo-kitchen",
        videoRevision: 1,
        frameIndex: 42,
        stillId: EVIDENCE.stillId,
        roomId: "kitchen",
        timestampMs: 12_000,
        stillHash: EVIDENCE.stillHash,
      }],
    });
  });

  it("creates parseable PDF bytes with evaluator signature, attestation, and correction dates", async () => {
    const exports = await buildMoveInReadyExportSet(withAnalysisProvenance());
    const documents = [
      exports.clientFilePdf,
      exports.landlordFixListPdf,
      exports.hmisReadyPdf,
    ];

    for (const bytes of documents) {
      expect(Buffer.from(bytes).subarray(0, 5).toString("ascii")).toBe("%PDF-");
      const parsed = await PDFDocument.load(bytes);
      expect(parsed.getPages().length).toBeGreaterThan(0);
    }

    const landlordText = decodedPdfStreams(exports.landlordFixListPdf);
    expect(landlordText).toContain("Typed evaluator signature: Demo Evaluator");
    expect(landlordText).toContain(EVALUATOR_ATTESTATION_TEXT);
    expect(landlordText).toContain("AI suggestions are not my decisions.");
    expect(landlordText).toContain("Completion date: 2026-11-02");
    expect(landlordText).toContain("Reinspection date: 2026-11-05");
    for (const pdf of [exports.clientFilePdf, exports.landlordFixListPdf, exports.hmisReadyPdf]) {
      const text = decodedPdfStreams(pdf);
      expect(text).toContain("Evaluator decision recorded by: Demo Evaluator");
      expect(text).toContain(`Evaluator decision recorded at: ${SIGNED_AT}`);
      expect(text).toContain("In-person check acknowledged by: Demo Evaluator");
      expect(text).toContain(`In-person check completed at: ${SIGNED_AT}`);
      expect(text).toContain("video video-demo-kitchen revision 1");
      expect(text).toContain("frame 42");
      expect(text).toContain(`still ${EVIDENCE.stillId}`);
      expect(text).toContain("Source video SHA-256:");
      expect(text).toContain("Analysis ID: analysis-demo-001");
    }

    expect(exports.json.elements).toHaveLength(MOVE_IN_READY_ELEMENTS.length);
  });

  it("fills the official three-page Form 1083 and attaches the full 11-element human record", async () => {
    const input = withConfirmedDeficiency();
    input.leadershipSignoffRequired = true;
    input.leadershipSignoff = "Agency Director";
    input.evaluatorAgencyName = "Demo Agency";
    input.landlordDiscussion = "yes";
    input.landlordDiscussionDate = "2026-10-28";
    input.leadershipNameAndTitle = "Jordan Lee, Program Director";
    input.leadershipSignedAt = "2026-10-29";
    input.decisions["demo-smoke-co"] = {
      status: "D",
      evaluatorName: "Demo Evaluator",
      decidedAt: SIGNED_AT,
      inPersonCheckAcknowledgment: {
        evaluatorName: "Demo Evaluator",
        completedAt: SIGNED_AT,
      },
      rationale: "The unit detector did not respond during the manual test.",
      evidence: [{ ...EVIDENCE }],
      analysisIdentity: null,
      fireSafetyAssessment: { unitDetectors: "D", publicAreaDetectors: "A" },
      deficiency: {
        issueDescription: "Unit smoke detector did not respond during the manual test.",
        correction: "Repair or replace the unit smoke detector and verify operation.",
        completionDate: "2026-11-02",
        reinspectionDate: "2026-11-05",
      },
    };
    input.decisions["demo-item-05"] = {
      status: "A",
      evaluatorName: "Demo Evaluator",
      decidedAt: SIGNED_AT,
      inPersonCheckAcknowledgment: {
        evaluatorName: "Demo Evaluator",
        completedAt: SIGNED_AT,
      },
      rationale: "The evaluator checked the visible structure in person.",
      evidence: [],
      analysisIdentity: null,
    };
    const exports = await buildMoveInReadyExportSet(input);
    const formText = decodedPdfStreams(exports.hmisReadyPdf);

    for (const [index, element] of MOVE_IN_READY_ELEMENTS.entries()) {
      expect(formText).toContain(`${String(index + 1).padStart(2, "0")}. ${element.label} -`);
    }
    expect(formText).toContain("Inspection result: NOT APPROVED");
    expect(formText).toContain("Local draft for manual handling");
    expect(formText).toContain("Evaluator rationale: The evaluator checked the visible structure in person.");
    expect(formText).toContain("Deficient area: Water supply. Observed issue: Kitchen faucet drips when closed.");
    expect(formText).toContain("Proposed correction: Repair the faucet cartridge and verify that it shuts off.");
    expect(formText).toContain("Completion date: 2026-11-02");
    expect(formText).toContain("Reinspection date: 2026-11-05");
    expect(formText).toContain("Typed signature: Demo Evaluator");
    expect(formText).toContain("Agency leadership sign-off required: Yes. Leadership signature: Agency Director.");
    expect(formText).toContain("Demo Evaluator - Demo Agency");
    expect(formText).toContain("YES");
    expect(formText).toContain("2026-10-28");
    expect(formText).toContain("Jordan Lee, Program Director");
    expect(formText).toContain("2026-10-29");
    expect(formText).toContain(EVALUATOR_ATTESTATION_TEXT);
    expect(formText).toContain("Planned reinspection: 2026-11-05");
    expect(formText).toContain("Separate unit detector result: D.");
    expect(formText).toContain("Separate public-area detector result: A.");
    expect(exports.json.evaluator.agencyName).toBe("Demo Agency");
    expect(exports.json.form1083).toMatchObject({
      landlordDiscussion: "yes",
      landlordDiscussionDate: "2026-10-28",
      leadershipNameAndTitle: "Jordan Lee, Program Director",
      leadershipSignedAt: "2026-10-29",
      fireSafetyAssessment: { unitDetectors: "D", publicAreaDetectors: "A" },
    });
    const parsed = await PDFDocument.load(exports.hmisReadyPdf);
    expect(parsed.getPages().length).toBeGreaterThan(3);
    expect(parsed.getForm().getFields()).toHaveLength(0);
  });

  it("keeps the official completed-reinspection date blank while showing the planned date in notes", async () => {
    const input = withConfirmedDeficiency();
    const pdf = (await buildMoveInReadyExportSet(input)).hmisReadyPdf;
    const text = decodedPdfStreams(pdf);

    // The planned date is printed once in the official form's notes field and
    // once in the appended evaluator record. A third occurrence would mean it
    // was also written into the distinct completed-reinspection field.
    expect(text).toContain("Planned reinspection: 2026-11-05");
    expect(countOccurrences(text, "2026-11-05")).toBe(2);

    const flattened = await PDFDocument.load(pdf);
    expect(flattened.getForm().getFields()).toHaveLength(0);
  });

  it("leaves participant/HMIS identity and unit-address fields blank in the flattened official form", async () => {
    const stagedOnlyInput = {
      ...inputFor(),
      // These synthetic sentinels prove that staged identity/address values
      // cannot leak into the official form, even if supplied by an untyped
      // caller. The product input contract deliberately has no such fields.
      participantName: "SYNTHETIC-PARTICIPANT-NAME-SENTINEL",
      hmisNumber: "SYNTHETIC-HMIS-NUMBER-SENTINEL",
      unitAddress: "SYNTHETIC-UNIT-ADDRESS-SENTINEL",
    } as MoveInReadyExportInput;
    const pdf = (await buildMoveInReadyExportSet(stagedOnlyInput)).hmisReadyPdf;
    const text = decodedPdfStreams(pdf);

    expect(text).not.toContain("SYNTHETIC-PARTICIPANT-NAME-SENTINEL");
    expect(text).not.toContain("SYNTHETIC-HMIS-NUMBER-SENTINEL");
    expect(text).not.toContain("SYNTHETIC-UNIT-ADDRESS-SENTINEL");

    const flattened = await PDFDocument.load(pdf);
    expect(flattened.getForm().getFields()).toHaveLength(0);
  });

  it("prints APPROVED in the HMIS-ready PDF when every evaluator decision is A", async () => {
    const exports = await buildMoveInReadyExportSet(inputFor());
    const formText = decodedPdfStreams(exports.hmisReadyPdf);

    expect(exports.json.result).toBe("approved");
    expect(formText).toContain("Inspection result: APPROVED");
  });

  it("wraps long unbroken worker text by rendered width without clipping it", async () => {
    const input = withConfirmedDeficiency();
    const unbrokenCorrection = "W".repeat(1000);
    const decision = input.decisions["demo-water-supply"];
    if (decision.status !== "D") throw new Error("Test setup requires a D decision.");
    decision.deficiency.correction = unbrokenCorrection;

    const exports = await buildMoveInReadyExportSet(input);
    const runs = decodedPdfTextRuns(exports.landlordFixListPdf);
    const wrappedRuns = runs.filter((run) => /^W+$/.test(run));

    expect(wrappedRuns.length).toBeGreaterThan(1);
    expect(wrappedRuns.reduce((total, run) => total + run.length, 0)).toBe(1000);
    expect(Math.max(...wrappedRuns.map((run) => run.length))).toBeLessThan(60);
    expect(await PDFDocument.load(exports.landlordFixListPdf)).toBeDefined();
  });

  it("preserves non-Latin Unicode in the downloadable PDFs and keeps displayed values aligned with JSON", async () => {
    const input = withConfirmedDeficiency();
    input.pseudonym = "Unit Ω 12";
    input.signoff = {
      evaluatorName: "Zoë Ω",
      typedSignature: "Zoë Ω",
      attested: true,
      signedAt: SIGNED_AT,
    };
    for (const decision of Object.values(input.decisions)) {
      if (decision.status === "A" || decision.status === "D") {
        decision.evaluatorName = "Zoë Ω";
        decision.inPersonCheckAcknowledgment = {
          ...decision.inPersonCheckAcknowledgment,
          evaluatorName: "Zoë Ω",
        };
      }
    }
    const water = input.decisions["demo-water-supply"];
    if (water.status !== "D") throw new Error("Test setup requires a D decision.");
    water.rationale = "Cyrillic Ж and CJK 猫 were checked in person.";
    water.deficiency.correction = "Replace 猫's faucet cartridge — résumé checked.";

    const dejavRegular = new Uint8Array(await readFile(new URL("../../../src/export/assets/DejaVuSans.ttf", import.meta.url)));
    const dejavBold = new Uint8Array(await readFile(new URL("../../../src/export/assets/DejaVuSans-Bold.ttf", import.meta.url)));
    const unifont = new Uint8Array(await readFile(new URL("../../../node_modules/@fontsource/unifont/files/unifont-latin-400-normal.woff2", import.meta.url)));
    const fontFetch = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      if (url === OFFICIAL_FORM_URL) {
        return new Response(new Uint8Array(officialFormFixture), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      const bytes = url.includes("unifont") ? unifont : url.includes("Bold") ? dejavBold : dejavRegular;
      return new Response(bytes, { status: 200 });
    });
    vi.stubGlobal("fetch", fontFetch);
    try {
      const exports = await buildMoveInReadyExportSet(input);
      const landlordStreams = inflatedPdfStreams(exports.landlordFixListPdf).join("\n");

      expect(exports.json.pseudonym).toBe("Unit Ω 12");
      expect(exports.json.evaluator.name).toBe("Zoë Ω");
      expect(exports.json.elements.find((element) => element.id === "demo-water-supply")?.deficiency?.correction)
        .toBe("Replace 猫's faucet cartridge — résumé checked.");
      expect(landlordStreams).toContain("03A9"); // Ω in the embedded-font ToUnicode map.
      expect(landlordStreams).toContain("732B"); // 猫 in the embedded-font ToUnicode map.
      expect((await PDFDocument.load(exports.landlordFixListPdf)).getPages().length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);
});
