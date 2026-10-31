import {
  MOVE_IN_READY_ELEMENTS,
  MOVE_IN_READY_ELEMENT_IDS,
  EVALUATOR_ATTESTATION_TEXT,
  deriveFinalInspectionResult,
  validateEvaluatorDecision,
  validateEvaluatorSignoff,
  type EvaluatorDecision,
  type EvaluatorDecisionSet,
  type EvaluatorSignoff,
  type EvidenceReference,
  type FireSafetyClauseOutcome,
  type FundingType,
  type MoveInReadyRoomId,
  type InPersonCheckAcknowledgment,
  type MoveInReadyElementId,
  type VideoAnalysisIdentity,
} from "../domain/move-in-ready";
import type { PDFFont, PDFPage } from "pdf-lib";

export type MoveInReadyExportKind = "client-file" | "landlord-fix-list" | "hmis-ready";

export interface ExportStill {
  evidence: EvidenceReference;
  /** JPEG bytes extracted from the source video; never generated or enhanced. */
  jpegBytes: Uint8Array;
}

export interface MoveInReadyExportInput {
  sessionId: string;
  pseudonym: string;
  fundingType: FundingType;
  capturedRoomIds: readonly MoveInReadyRoomId[];
  decisions: EvaluatorDecisionSet;
  signoff: EvaluatorSignoff;
  leadershipSignoffRequired?: boolean;
  leadershipSignoff?: string;
  /** Optional fields printed on LAHSA Form 1083 and collected by the host UI. */
  evaluatorAgencyName?: string;
  landlordDiscussion?: "yes" | "no";
  landlordDiscussionDate?: string;
  leadershipNameAndTitle?: string;
  leadershipSignedAt?: string;
  generatedAt?: string;
  stills: readonly ExportStill[];
}

export interface HmisReadyJson {
  schema: "move-in-ready-hmis-draft-v2";
  notice: string;
  sessionId: string;
  pseudonym: string;
  fundingType: "lahsa";
  result: "approved" | "not-approved";
  evaluator: {
    name: string;
    agencyName: string | null;
    typedSignature: string;
    attested: true;
    attestationText: string;
    signedAt: string;
    leadershipSignatureRequired: boolean;
    leadershipSignature: string | null;
  };
  form1083: {
    landlordDiscussion: "yes" | "no" | null;
    landlordDiscussionDate: string | null;
    leadershipNameAndTitle: string | null;
    leadershipSignedAt: string | null;
    fireSafetyAssessment: {
      unitDetectors: FireSafetyClauseOutcome | null;
      publicAreaDetectors: FireSafetyClauseOutcome | null;
    };
  };
  elements: Array<{
    id: MoveInReadyElementId;
    label: string;
    decision: "A" | "D";
    rationale: string;
    evaluatorName: string;
    decidedAt: string;
    inPersonCheckAcknowledgment: InPersonCheckAcknowledgment;
    analysisIdentity: VideoAnalysisIdentity | null;
    evidence: Array<{
      schemaVersion: number;
      catalogVersion: string;
      videoId: string;
      videoRevision: number;
      frameIndex: number | null;
      stillId: string;
      roomId: EvidenceReference["roomId"];
      timestampMs: number;
      stillHash: string;
    }>;
    deficiency?: {
      issueDescription: string;
      correction: string;
      completionDate: string;
      reinspectionDate: string;
    };
  }>;
}

export interface MoveInReadyExportSet {
  clientFilePdf: Uint8Array;
  landlordFixListPdf: Uint8Array;
  hmisReadyPdf: Uint8Array;
  hmisReadyJson: Uint8Array;
  json: HmisReadyJson;
}

export const MOVE_IN_READY_EXPORT_NOTICE =
  "Local draft for manual handling. This app does not submit to HMIS or confirm acceptance by LAHSA.";

const OFFICIAL_FORM_1083_URL = "/forms/lahsa-form-1083-fy-2022-2023.pdf";
const OFFICIAL_FORM_1083_SHA256 =
  "9c9faf9039d98aa570017f6bf22bafd5a999c1ba3f25a8f8bee3241546602261";
const FORM_1083_MAX_DEFICIENCY_ROWS = 6;
let officialForm1083Bytes: Promise<Uint8Array> | undefined;

/** Build the three self-contained signed PDFs and companion HMIS-style JSON. */
export async function buildMoveInReadyExportSet(
  input: MoveInReadyExportInput,
): Promise<MoveInReadyExportSet> {
  const json = await buildHmisReadyJson(input);
  const clientFilePdf = await buildPdf(input, json, "client-file");
  const landlordFixListPdf = await buildPdf(input, json, "landlord-fix-list");
  const hmisReadyPdf = await buildPdf(input, json, "hmis-ready");
  return {
    clientFilePdf,
    landlordFixListPdf,
    hmisReadyPdf,
    hmisReadyJson: new TextEncoder().encode(JSON.stringify(json, null, 2)),
    json,
  };
}

/** Build only the requested PDF so mobile exports do not regenerate unused files. */
export async function buildMoveInReadyPdf(
  input: MoveInReadyExportInput,
  kind: MoveInReadyExportKind,
): Promise<Uint8Array> {
  const json = await buildHmisReadyJson(input);
  return buildPdf(input, json, kind);
}

export async function buildHmisReadyJson(input: MoveInReadyExportInput): Promise<HmisReadyJson> {
  await assertExportable(input);
  const elements = MOVE_IN_READY_ELEMENTS.map((element) => {
    const decision = input.decisions[element.id];
    if (decision.status !== "A" && decision.status !== "D") {
      throw new Error("Every element must have an evaluator decision before export.");
    }
    return {
      id: element.id,
      label: element.label,
      decision: decision.status,
      rationale: cleanText(decision.rationale, 1000),
      evaluatorName: cleanText(decision.evaluatorName, 120),
      decidedAt: decision.decidedAt,
      inPersonCheckAcknowledgment: {
        evaluatorName: cleanText(decision.inPersonCheckAcknowledgment.evaluatorName, 120),
        completedAt: decision.inPersonCheckAcknowledgment.completedAt,
      },
      analysisIdentity: decision.analysisIdentity
        ? { ...decision.analysisIdentity }
        : null,
      evidence: decision.evidence.map((evidence) => ({
        schemaVersion: evidence.schemaVersion,
        catalogVersion: evidence.catalogVersion,
        videoId: evidence.videoId,
        videoRevision: evidence.videoRevision,
        frameIndex: evidence.frameIndex,
        stillId: evidence.stillId,
        roomId: evidence.roomId,
        timestampMs: evidence.timestampMs,
        stillHash: evidence.stillHash,
      })),
      ...(decision.status === "D"
        ? {
            deficiency: {
              issueDescription: cleanText(decision.deficiency.issueDescription, 1000),
              correction: cleanText(decision.deficiency.correction, 1000),
              completionDate: decision.deficiency.completionDate,
              reinspectionDate: decision.deficiency.reinspectionDate,
            },
          }
        : {}),
    };
  });
  const result = elements.some((element) => element.decision === "D")
    ? "not-approved"
    : "approved";
  const fireSafetyDecision = input.decisions["demo-smoke-co"];
  const fireSafetyAssessment = "fireSafetyAssessment" in fireSafetyDecision
    ? fireSafetyDecision.fireSafetyAssessment
    : undefined;
  return {
    schema: "move-in-ready-hmis-draft-v2",
    notice: MOVE_IN_READY_EXPORT_NOTICE,
    sessionId: safeIdentifier(input.sessionId),
    pseudonym: cleanText(input.pseudonym, 80),
    fundingType: "lahsa",
    result,
    evaluator: {
      name: cleanText(input.signoff.evaluatorName, 120),
      agencyName: input.evaluatorAgencyName?.trim()
        ? cleanText(input.evaluatorAgencyName, 120)
        : null,
      typedSignature: cleanText(input.signoff.typedSignature, 120),
      attested: true,
      attestationText: EVALUATOR_ATTESTATION_TEXT,
      signedAt: input.signoff.signedAt,
      leadershipSignatureRequired: input.leadershipSignoffRequired === true,
      leadershipSignature: input.leadershipSignoff?.trim()
        ? cleanText(input.leadershipSignoff, 120)
        : null,
    },
    form1083: {
      landlordDiscussion: input.landlordDiscussion ?? null,
      landlordDiscussionDate: input.landlordDiscussion === "yes" && input.landlordDiscussionDate?.trim()
        ? dateOnly(cleanText(input.landlordDiscussionDate, 80))
        : null,
      leadershipNameAndTitle: input.leadershipNameAndTitle?.trim()
        ? cleanText(input.leadershipNameAndTitle, 160)
        : null,
      leadershipSignedAt: input.leadershipSignedAt?.trim()
        ? dateOnly(cleanText(input.leadershipSignedAt, 80))
        : null,
      fireSafetyAssessment: {
        unitDetectors: fireSafetyAssessment?.unitDetectors ?? null,
        publicAreaDetectors: fireSafetyAssessment?.publicAreaDetectors ?? null,
      },
    },
    elements,
  };
}

export function exportFilename(kind: MoveInReadyExportKind, sessionId: string, generatedAt = new Date().toISOString()): string {
  const timestamp = generatedAt.replace(/[^0-9T]/g, "-").replace(/-+$/, "");
  return `move-in-ready-${kind}-${safeIdentifier(sessionId)}-${timestamp}.pdf`;
}

async function buildPdf(
  input: MoveInReadyExportInput,
  json: HmisReadyJson,
  kind: MoveInReadyExportKind,
): Promise<Uint8Array> {
  if (kind === "hmis-ready") return buildOfficialHmisReadyPdf(input, json);

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const fonts = new PdfFontRegistry(document, regular, bold);
  const pageSize: [number, number] = [612, 792];
  const margin = 48;
  const contentWidth = pageSize[0] - margin * 2;
  let page = document.addPage(pageSize);
  let cursorY = pageSize[1] - margin;

  const title = titleFor(kind);
  await drawText(page, "MOVE-IN READY · LOCAL DRAFT", {
    x: margin,
    y: cursorY,
    size: 9,
    weight: "bold",
    fonts,
    color: rgb(0.07, 0.32, 0.62),
  });
  cursorY -= 24;
  await drawText(page, title, { x: margin, y: cursorY, size: 20, weight: "bold", fonts, color: rgb(0.08, 0.1, 0.14) });
  cursorY -= 24;
  drawRule(page, margin, cursorY, contentWidth, rgb(0.78, 0.82, 0.88));
  cursorY -= 20;

  const meta = [
    `Unit pseudonym: ${json.pseudonym || "Not entered"}`,
    `Funding route: ${input.fundingType === "lahsa" ? "LAHSA Form 1083" : "Not eligible for this export"}`,
    `Evaluator: ${json.evaluator.name}`,
    `Typed evaluator signature: ${json.evaluator.typedSignature}`,
    `Signed: ${json.evaluator.signedAt}`,
    `Result from evaluator decisions: ${json.result === "approved" ? "APPROVED" : "NOT APPROVED"}`,
  ];
  for (const line of meta) {
    cursorY = await drawWrappedText(page, line, {
      x: margin,
      y: cursorY,
      size: 10,
      lineHeight: 15,
      maxWidth: contentWidth,
      fonts,
      color: rgb(0.14, 0.18, 0.24),
    });
  }
  cursorY = await drawWrappedText(page, EVALUATOR_ATTESTATION_TEXT, {
    x: margin,
    y: cursorY,
    size: 8,
    lineHeight: 11,
    maxWidth: contentWidth,
    fonts,
    color: rgb(0.24, 0.29, 0.35),
  });
  if (json.evaluator.leadershipSignature) {
    cursorY = await drawWrappedText(page, `Agency leadership sign-off: ${json.evaluator.leadershipSignature}`, {
      x: margin, y: cursorY, size: 10, lineHeight: 15, maxWidth: contentWidth,
      fonts, color: rgb(0.14, 0.18, 0.24),
    });
  }
  if (json.evaluator.leadershipSignatureRequired) {
    cursorY = await drawWrappedText(page, `Agency leadership required: ${json.evaluator.leadershipSignature ?? "Not signed"}`, {
      x: margin, y: cursorY, size: 10, lineHeight: 15, maxWidth: contentWidth,
      fonts, color: rgb(0.14, 0.18, 0.24),
    });
  }
  cursorY -= 5;
  cursorY = await drawWrappedText(page, MOVE_IN_READY_EXPORT_NOTICE, {
    x: margin, y: cursorY, size: 8, lineHeight: 11, maxWidth: contentWidth,
    fonts, color: rgb(0.35, 0.4, 0.48),
  });
  cursorY -= 14;

  const stillByIdentity = new Map(input.stills.map((item) => [evidenceKey(item.evidence), item]));
  const elements = json.elements.filter((element) => {
    return kind !== "landlord-fix-list" || element.decision === "D";
  });
  if (kind === "landlord-fix-list" && elements.length === 0) {
    await drawText(page, "No evaluator-confirmed deficiencies are listed.", {
      x: margin, y: cursorY, size: 12, weight: "bold", fonts, color: rgb(0.12, 0.35, 0.2),
    });
    cursorY -= 24;
  }

  for (const element of elements) {
    const decision = input.decisions[element.id];
    if (decision.status !== "A" && decision.status !== "D") {
      throw new Error("An evaluator decision became incomplete during export.");
    }
    const bodyLines = element.decision === "D"
      ? [
          `Evaluator decision: D - ${element.rationale}`,
          `Observed issue: ${element.deficiency!.issueDescription}`,
          `Correction: ${element.deficiency!.correction}`,
          `Completion date: ${element.deficiency!.completionDate}`,
          `Reinspection date: ${element.deficiency!.reinspectionDate}`,
        ]
      : [`Evaluator decision: A - ${element.rationale}`];
    const provenanceLines = [
      ...decisionProvenanceLines(decision),
      ...evidenceProvenanceLines(decision.evidence),
    ];
    const textBlocks = await Promise.all([...bodyLines, ...provenanceLines].map((line) => prepareWrappedText(line, {
      size: 9,
      lineHeight: 13,
      maxWidth: contentWidth - 24,
      fonts,
    })));
    const textLineCount = textBlocks.reduce((total, block) => total + block.lines.length, 0);
    const evidenceReferences = decision.evidence;
    const evidence = evidenceReferences.map((reference) => {
      const still = stillByIdentity.get(evidenceKey(reference));
      if (!still) throw new Error("A cited source video still is missing from the export.");
      return { reference, still };
    });
    const evidenceRows = Math.ceil(evidence.length / 3);
    const cardHeight = 44 + textLineCount * 13 + evidenceRows * 98;
    const maximumCardHeight = pageSize[1] - margin * 2 - 24;
    if (cardHeight > maximumCardHeight) {
      throw new Error("This decision is too long to fit safely in a PDF page. Shorten the note and retry export.");
    }
    if (cursorY - cardHeight < margin + 24) {
      page = document.addPage(pageSize);
      cursorY = pageSize[1] - margin;
    }
    page.drawRectangle({
      x: margin,
      y: cursorY - cardHeight,
      width: contentWidth,
      height: cardHeight,
      borderColor: rgb(0.78, 0.82, 0.88),
      borderWidth: 0.8,
      color: rgb(1, 1, 1),
    });
    await drawText(page, `${element.id}  ${element.label}`, {
      x: margin + 12,
      y: cursorY - 20,
      size: 11,
      weight: "bold",
      fonts,
      color: rgb(0.08, 0.1, 0.14),
    });
    let lineY = cursorY - 38;
    for (const block of textBlocks) {
      lineY = drawWrappedBlock(page, block, margin + 12, lineY, rgb(0.14, 0.18, 0.24));
    }
    if (evidence.length) {
      const cardBottom = cursorY - cardHeight;
      for (const [index, { reference, still }] of evidence.entries()) {
        const image = await document.embedJpg(still.jpegBytes);
        const scale = Math.min(112 / image.width, 68 / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        const row = Math.floor(index / 3);
        const column = index % 3;
        const x = margin + 12 + column * 130;
        const rowY = cardBottom + 12 + (evidenceRows - row - 1) * 98;
        page.drawImage(image, { x, y: rowY + 12, width, height });
        await drawText(page, `Evidence ${index + 1} · ${reference.roomId} · ${formatTime(reference.timestampMs)}`, {
          x, y: rowY, size: 6, weight: "regular", fonts, color: rgb(0.22, 0.28, 0.34),
        });
      }
    }
    cursorY -= cardHeight + 12;
  }

  for (const pdfPage of document.getPages()) {
    await drawText(pdfPage, "Local/manual workflow · Not an HMIS submission", {
      x: margin,
      y: 24,
      size: 8,
      weight: "regular",
      fonts,
      color: rgb(0.38, 0.42, 0.48),
    });
  }
  return document.save();
}

/**
 * Build the HMIS-ready copy on LAHSA's owner-confirmed 2022-2023 Form 1083.
 * The source PDF has several widgets sharing one field name; those marks are
 * flattened and drawn independently so one evaluator decision cannot stamp
 * every repeated row with the same value. All supporting notes and evidence
 * are attached after the three original form pages.
 */
async function buildOfficialHmisReadyPdf(
  input: MoveInReadyExportInput,
  json: HmisReadyJson,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const document = await PDFDocument.load(await loadOfficialForm1083Bytes(), {
    updateMetadata: false,
  });
  const pages = document.getPages();
  if (pages.length !== 3) throw new Error("The official Form 1083 template has an unexpected page count.");

  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const fonts = new PdfFontRegistry(document, regular, bold);
  const form = document.getForm();
  const sharedDateField = form.getTextField("Date");
  const sharedDateWidgets = sharedDateField.acroField.getWidgets().map((widget) => {
    const pageRef = widget.P();
    const pageIndex = pageRef
      ? pages.findIndex((candidate) => candidate.ref.toString() === pageRef.toString())
      : -1;
    if (pageIndex < 0) throw new Error("The official Form 1083 date fields could not be mapped to pages.");
    return { pageIndex, rectangle: widget.getRectangle() };
  }).sort((a, b) => a.pageIndex - b.pageIndex || b.rectangle.y - a.rectangle.y);
  if (sharedDateWidgets.length !== 2) {
    throw new Error("The official Form 1083 date fields do not match the expected form.");
  }
  sharedDateField.setText("");

  // This source field is malformed: one field name is shared by nine
  // different A/D widgets. Retain the widget positions, remove the shared
  // field, and draw each decision independently after the remaining fields
  // are flattened.
  const getWidgetPositions = (fieldName: string) => form.getTextField(fieldName).acroField.getWidgets().map((widget) => {
    const pageRef = widget.P();
    const pageIndex = pageRef
      ? pages.findIndex((candidate) => candidate.ref.toString() === pageRef.toString())
      : -1;
    if (pageIndex < 0) throw new Error("The official Form 1083 decision fields could not be mapped to pages.");
    return { pageIndex, rectangle: widget.getRectangle() };
  });
  const repeatedStatusField = form.getTextField("Approved or DeficientRow4");
  const repeatedStatusWidgets = getWidgetPositions("Approved or DeficientRow4")
    .sort((a, b) => a.pageIndex - b.pageIndex || b.rectangle.y - a.rectangle.y);
  if (repeatedStatusWidgets.length !== MOVE_IN_READY_ELEMENTS.length - 2) {
    throw new Error("The official Form 1083 decision fields do not match the 11-element catalog.");
  }
  // Keep the source widget geometry intact; the empty shared field is
  // flattened below, then independent A/D marks are drawn over its widgets.
  repeatedStatusField.setText("");

  const elementById = new Map(MOVE_IN_READY_ELEMENTS.map((element) => [element.id, element]));
  const decisions = json.elements.map((element) => ({
    element,
    decision: input.decisions[element.id],
  }));

  // Form 1083 has three independently named decision boxes, then nine
  // repeated widgets for rows 4-11b. Its 11a and 11b marks come only from
  // separately captured unit and public-area detector assessments.
  for (const fieldName of [
    "Approved or DeficientRow1",
    "Approved or DeficientRow2",
    "Approved or DeficientRow3",
  ]) {
    const field = form.getTextField(fieldName);
    if (getWidgetPositions(fieldName).length !== 1) {
      throw new Error("The official Form 1083 decision fields do not match the expected form.");
    }
    field.setText("");
  }
  const firstStatusWidgets = [
    "Approved or DeficientRow1",
    "Approved or DeficientRow2",
    "Approved or DeficientRow3",
  ].flatMap(getWidgetPositions);
  const allStatusWidgets = [...firstStatusWidgets, ...repeatedStatusWidgets];
  if (allStatusWidgets.length !== MOVE_IN_READY_ELEMENTS.length + 1) {
    throw new Error("The official Form 1083 decision fields do not match the 11-element catalog.");
  }

  const noteFieldPrefixes = [
    "Notes1 ",
    "Notes2 ",
    "Notes3 ",
    "Notes4 ",
    "5 Water Supply",
    "6 Sanitary Facilities",
    "7 Thermal environment",
    "8 Lighting and electricity",
    "9 Food preparation and refuse disposal",
    "10 Sanitary condition",
    "11 a. Fire safety",
    "11 b The public areas",
  ];
  const formNotesByElement = decisions.slice(0, 10).map(({ decision }, index) => {
    if (decision.status !== "A" && decision.status !== "D") {
      throw new Error("An evaluator decision became incomplete during export.");
    }
    return {
      prefix: noteFieldPrefixes[index]!,
      value: decision.status === "D"
        ? compactFormValue(`Issue: ${decision.deficiency.issueDescription}`, 150, "See attached deficiency details.")
        : compactFormValue(decision.rationale, 150, "See attached evaluator notes."),
    };
  });
  const unitDetectorStatus = json.form1083.fireSafetyAssessment.unitDetectors;
  const publicAreaDetectorStatus = json.form1083.fireSafetyAssessment.publicAreaDetectors;
  formNotesByElement.push(
    {
      prefix: noteFieldPrefixes[10],
      value: unitDetectorStatus === "A" || unitDetectorStatus === "D"
        ? `Separate unit detector result: ${unitDetectorStatus}.`
        : unitDetectorStatus === "needs-human-check"
          ? "Unit detector check needs human completion."
        : "Not separately assessed in this export.",
    },
    {
      prefix: noteFieldPrefixes[11],
      value: publicAreaDetectorStatus === "A" || publicAreaDetectorStatus === "D"
        ? `Separate public-area detector result: ${publicAreaDetectorStatus}.`
        : publicAreaDetectorStatus === "needs-human-check"
          ? "Public-area detector check needs human completion."
        : "Not separately assessed in this export.",
    },
  );
  for (const note of formNotesByElement) setFormTextFieldByPrefix(form, note.prefix, note.value, 6);

  const allFormStatuses: Array<"A" | "D" | null> = [
    ...decisions.slice(0, 10).map(({ decision }) => decision.status === "A" || decision.status === "D" ? decision.status : null),
    unitDetectorStatus === "A" || unitDetectorStatus === "D" ? unitDetectorStatus : null,
    publicAreaDetectorStatus === "A" || publicAreaDetectorStatus === "D" ? publicAreaDetectorStatus : null,
  ];

  // Form 1083 provides six correction rows. The complete list is also
  // attached, so the original form stays accurate when more than six items
  // are deficient.
  const deficiencies = decisions.filter(({ decision }) => decision.status === "D");
  for (const [rowIndex, { element, decision }] of deficiencies.slice(0, FORM_1083_MAX_DEFICIENCY_ROWS).entries()) {
    if (decision.status !== "D") continue;
    const row = rowIndex + 1;
    setFormTextField(form, `Deficient AreaRow${row}`, element.label, 7);
    setFormTextField(form, `Proposed CorrectionRow${row}`, compactFormValue(
      decision.deficiency.correction,
      78,
      "See attached deficiency details.",
    ), 5.5);
    setFormTextField(form, `Date will be completedRow${row}`, decision.deficiency.completionDate, 6.5);
    // This field records a completed inspection date. The app only captures a
    // planned date, so leave it blank and label that plan in the adjacent notes.
    setFormTextField(form, `Date Reinspection CompletedRow${row}`, "", 6.5);
    setFormTextField(form, `NOTES with datesRow${row}`, compactFormValue(
      `Planned reinspection: ${dateOnly(decision.deficiency.reinspectionDate)}. Issue: ${decision.deficiency.issueDescription}`,
      100,
      `Planned reinspection: ${dateOnly(decision.deficiency.reinspectionDate)}`,
    ), 5.5);
  }

  // The form intentionally keeps participant/HMIS identity and unit address
  // blank: this application only has staged mock-unit data and a pseudonym.
  // Likewise, do not inherit the source PDF's default YES for landlord
  // discussion; the captured choice is required and mapped explicitly.
  const landlordDiscussionField = form.getDropdown("Discussed with LL");
  landlordDiscussionField.clear();
  if (json.form1083.landlordDiscussion) {
    landlordDiscussionField.select(json.form1083.landlordDiscussion.toUpperCase());
  }
  const evaluatorAgencyName = [json.evaluator.name, json.evaluator.agencyName]
    .filter((value): value is string => Boolean(value))
    .join(" - ");
  setFormTextField(form, "Evaluator and Agency Name", evaluatorAgencyName, 7.5);
  setFormTextField(form, "Evaluator's Signature", json.evaluator.typedSignature, 8);
  setFormTextField(form, "Date 2", dateOnly(json.evaluator.signedAt), 6.5);
  if (json.form1083.leadershipNameAndTitle) {
    setFormTextField(form, "Agency Leadership  Printed Name and Title", json.form1083.leadershipNameAndTitle, 7);
  }
  if (json.evaluator.leadershipSignature) {
    setFormTextField(form, "Leadership Signature", json.evaluator.leadershipSignature, 7);
  }

  const formText = collectNonEmptyFormText(form);
  const formFont = await fonts.forText(formText, "regular");
  form.updateFieldAppearances(formFont);
  form.flatten();

  // Draw each A/D mark after flattening. The source form reuses one field for
  // nine widgets, and PDF field auto-sizing otherwise produces inconsistent,
  // oversized marks.
  for (const [index, widget] of allStatusWidgets.entries()) {
    const status = allFormStatuses[index];
    if (!status) continue;
    const { x, y, width, height } = widget.rectangle;
    const size = 8.5;
    const textWidth = bold.widthOfTextAtSize(status, size);
    pages[widget.pageIndex].drawText(status, {
      x: x + (width - textWidth) / 2,
      y: y + (height - size) / 2 + 1.5,
      size,
      font: bold,
      color: rgb(0.07, 0.25, 0.42),
    });
  }

  // Certification result boxes are printed artwork rather than AcroForm
  // controls. Mark only the result derived from all 11 evaluator decisions.
  const resultPage = pages[2];
  const selectedResult = json.result === "approved"
    ? { x: 73.60398, y: 596.76575 }
    : { x: 287.354, y: 596.21564 };
  resultPage.drawText("X", {
    x: selectedResult.x + 5.2,
    y: selectedResult.y + 3.5,
    size: 10,
    font: bold,
    color: rgb(0.07, 0.25, 0.42),
  });
  for (const [index, value] of [
    json.form1083.landlordDiscussionDate,
    json.form1083.leadershipSignedAt,
  ].entries()) {
    if (!value) continue;
    const field = sharedDateWidgets[index];
    const { x, y } = field.rectangle;
    pages[field.pageIndex].drawText(value, {
      x: x + 3,
      y: y + 7,
      size: 6.5,
      font: regular,
      color: rgb(0.12, 0.15, 0.2),
    });
  }

  const deficiencyContinuation = deficiencies.length > FORM_1083_MAX_DEFICIENCY_ROWS;
  if (deficiencyContinuation) {
    resultPage.drawText("Additional deficiencies are listed in the attached continuation.", {
      x: 72,
      y: 542,
      size: 7,
      font: regular,
      color: rgb(0.55, 0.15, 0.12),
    });
  }
  for (const page of pages) {
    page.drawText("LOCAL DRAFT - Supporting notes and source-video evidence follow. Manual handling only; not an HMIS submission.", {
      x: 35,
      y: 774,
      size: 5.5,
      font: regular,
      color: rgb(0.15, 0.31, 0.48),
    });
  }

  await appendOfficialForm1083Supplement({
    document,
    fonts,
    input,
    json,
    deficiencies,
    elementById,
  });
  return document.save();
}

async function loadOfficialForm1083Bytes(): Promise<Uint8Array> {
  if (!officialForm1083Bytes) {
    officialForm1083Bytes = fetch(OFFICIAL_FORM_1083_URL, { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error("The official LAHSA Form 1083 template could not be loaded.");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength < 100_000 || bytes.byteLength > 1_000_000 ||
            !startsWithPdf(bytes) ||
            await sha256Hex(bytes) !== OFFICIAL_FORM_1083_SHA256) {
          throw new Error("The official LAHSA Form 1083 template failed its integrity check.");
        }
        return bytes;
      })
      .catch((error: unknown) => {
        officialForm1083Bytes = undefined;
        throw error;
      });
  }
  return new Uint8Array(await officialForm1083Bytes);
}

function startsWithPdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

function setFormTextField(
  form: import("pdf-lib").PDFForm,
  fieldName: string,
  value: string,
  fontSize = 6.5,
): void {
  const field = form.getTextField(fieldName);
  field.setText(value);
  field.setFontSize(fontSize);
}

function setFormTextFieldByPrefix(
  form: import("pdf-lib").PDFForm,
  fieldPrefix: string,
  value: string,
  fontSize = 6.5,
): void {
  const matchingFields = form.getFields().filter((field) => field.getName().startsWith(fieldPrefix));
  if (matchingFields.length !== 1) {
    throw new Error("The official LAHSA Form 1083 notes fields could not be mapped safely.");
  }
  setFormTextField(form, matchingFields[0].getName(), value, fontSize);
}

function compactFormValue(value: string, maxLength: number, fallback: string): string {
  const cleaned = cleanText(value, 2000);
  return cleaned.length <= maxLength ? cleaned : fallback;
}

function collectNonEmptyFormText(form: import("pdf-lib").PDFForm): string {
  return form.getFields().map((field) => {
    if (field.constructor.name === "PDFTextField") {
      return form.getTextField(field.getName()).getText() ?? "";
    }
    return "";
  }).join(" ");
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

async function appendOfficialForm1083Supplement(options: {
  document: import("pdf-lib").PDFDocument;
  fonts: PdfFontRegistry;
  input: MoveInReadyExportInput;
  json: HmisReadyJson;
  deficiencies: Array<{ element: HmisReadyJson["elements"][number]; decision: EvaluatorDecision }>;
  elementById: Map<string, (typeof MOVE_IN_READY_ELEMENTS)[number]>;
}): Promise<void> {
  const { document, fonts, input, json, deficiencies, elementById } = options;
  const { rgb } = await import("pdf-lib");
  const pageWidth = 612;
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;
  const bottomMargin = 46;
  let page = document.getPages()[0];
  let cursorY = 0;
  let appendixPage = 0;

  const newPage = async (): Promise<void> => {
    page = document.addPage([612, 792]);
    cursorY = 750;
    appendixPage += 1;
    await drawText(page, "LAHSA FORM 1083 - LOCAL SUPPORTING RECORD", {
      x: margin,
      y: cursorY,
      size: 9,
      weight: "bold",
      fonts,
      color: rgb(0.07, 0.25, 0.42),
    });
    cursorY -= 17;
    await drawText(page, `Staged unit pseudonym: ${json.pseudonym || "Not entered"}  |  Appendix page ${appendixPage}`, {
      x: margin,
      y: cursorY,
      size: 8,
      fonts,
      color: rgb(0.16, 0.2, 0.26),
    });
    cursorY -= 12;
    drawRule(page, margin, cursorY, contentWidth, rgb(0.72, 0.77, 0.83));
    cursorY -= 15;
    page.drawText("Local draft for manual handling; this app does not submit to HMIS or confirm LAHSA acceptance.", {
      x: margin,
      y: 23,
      size: 6,
      font: regularFontForAppendix(fonts),
      color: rgb(0.38, 0.42, 0.48),
    });
  };

  await newPage();
  const appendText = async (
    value: string,
    options: { size?: number; lineHeight?: number; weight?: "regular" | "bold"; gap?: number } = {},
  ): Promise<void> => {
    const size = options.size ?? 8.5;
    const lineHeight = options.lineHeight ?? 11;
    const block = await prepareWrappedText(value, {
      size,
      lineHeight,
      maxWidth: contentWidth,
      fonts,
      weight: options.weight,
    });
    const blockHeight = block.lines.length * lineHeight;
    if (cursorY - blockHeight < bottomMargin) await newPage();
    cursorY = drawWrappedBlock(page, block, margin, cursorY, rgb(0.14, 0.18, 0.24));
    cursorY -= options.gap ?? 4;
  };

  await appendText("Inspection result: " + (json.result === "approved" ? "APPROVED" : "NOT APPROVED"), {
    size: 10,
    lineHeight: 13,
    weight: "bold",
  });
  await appendText(`Form edition: LAHSA Form 1083, FY 2022-2023. Evaluator: ${json.evaluator.name}. Typed signature: ${json.evaluator.typedSignature}. Signed: ${dateOnly(json.evaluator.signedAt)}.`);
  await appendText(json.evaluator.attestationText);
  await appendText(`Agency leadership sign-off required: ${json.evaluator.leadershipSignatureRequired ? "Yes" : "No"}. Leadership signature: ${json.evaluator.leadershipSignature ?? "Not recorded"}.`);
  await appendText("Participant name/HMIS number and unit address are intentionally blank because this workflow contains staged mock-unit data only.");
  await appendText(`Evaluator agency: ${json.evaluator.agencyName ?? "Not recorded"}. Landlord discussion: ${json.form1083.landlordDiscussion?.toUpperCase() ?? "Not recorded"}; date: ${json.form1083.landlordDiscussionDate ?? "Not recorded"}.`);
  await appendText(`Agency leadership name/title: ${json.form1083.leadershipNameAndTitle ?? "Not recorded"}. Leadership signature date: ${json.form1083.leadershipSignedAt ?? "Not recorded"}.`);
  await appendText("The attached app record includes its aggregate Fire safety evaluator decision. Form 1083 fields 11a and 11b are marked only from the separate unit-detector and public-area-detector assessments supplied for this export; the aggregate result is not copied to either clause.");

  if (deficiencies.length > FORM_1083_MAX_DEFICIENCY_ROWS) {
    await appendText(`Deficiency continuation: the official form has ${FORM_1083_MAX_DEFICIENCY_ROWS} correction rows. The remaining ${deficiencies.length - FORM_1083_MAX_DEFICIENCY_ROWS} evaluator-confirmed deficiencies continue here.`, {
      size: 9,
      weight: "bold",
      gap: 6,
    });
  }

  await appendText("Evaluator decisions and notes", { size: 10, weight: "bold", gap: 6 });
  for (const [index, element] of json.elements.entries()) {
    const catalogElement = elementById.get(element.id);
    if (!catalogElement) throw new Error("An exported Form 1083 element is not in the fixed catalog.");
    const decisionInput = input.decisions[element.id];
    if (decisionInput.status !== "A" && decisionInput.status !== "D") {
      throw new Error("An evaluator decision became incomplete during export.");
    }
    await appendText(`${String(index + 1).padStart(2, "0")}. ${element.label} - ${element.decision === "A" ? "APPROVED (A)" : "DEFICIENT (D)"}`, {
      size: 9,
      weight: "bold",
      gap: 3,
    });
    await appendText(`Evaluator rationale: ${element.rationale || "No evaluator rationale recorded."}`);
    await appendText(`Evaluator decision: ${element.evaluatorName}, recorded ${element.decidedAt}. In-person check acknowledged by ${element.inPersonCheckAcknowledgment.evaluatorName} at ${element.inPersonCheckAcknowledgment.completedAt}.`);
    if (element.deficiency) {
      await appendText(`Deficient area: ${catalogElement.label}. Observed issue: ${element.deficiency.issueDescription}`);
      await appendText(`Proposed correction: ${element.deficiency.correction}`);
      await appendText(`Completion date: ${element.deficiency.completionDate}. Reinspection date: ${element.deficiency.reinspectionDate}.`);
      const deficiencyIndex = deficiencies.findIndex((entry) => entry.element.id === element.id);
      if (deficiencyIndex >= FORM_1083_MAX_DEFICIENCY_ROWS) {
        await appendText(`Continuation row ${deficiencyIndex - FORM_1083_MAX_DEFICIENCY_ROWS + 1}; official Form 1083 row ${deficiencyIndex + 1} is not available.`);
      }
    }
    for (const line of decisionProvenanceLines(decisionInput)) await appendText(line, { size: 7.5, lineHeight: 9.5, gap: 2 });
    if (!element.evidence.length) {
      await appendText("Source-video stills: none attached to this human decision.", { size: 7.5, lineHeight: 9.5 });
    }
    cursorY -= 7;
  }

  await appendText("Source-video evidence", { size: 10, weight: "bold", gap: 7 });
  const stillByIdentity = new Map(input.stills.map((still) => [evidenceKey(still.evidence), still]));
  for (const element of json.elements) {
    for (const [evidenceIndex, reference] of element.evidence.entries()) {
      const still = stillByIdentity.get(evidenceKey(reference));
      if (!still) throw new Error("A cited source video still is missing from the Form 1083 attachment.");
      const image = await document.embedJpg(still.jpegBytes);
      const imageScale = Math.min(210 / image.width, 105 / image.height);
      const imageWidth = image.width * imageScale;
      const imageHeight = image.height * imageScale;
      const evidenceText = `Element ${element.label} - evidence ${evidenceIndex + 1}: ${reference.roomId}, ${formatTime(reference.timestampMs)} (${reference.timestampMs} ms), frame ${reference.frameIndex === null ? "local still" : reference.frameIndex}. Video ${reference.videoId}, revision ${reference.videoRevision}; still ${reference.stillId}; SHA-256 ${reference.stillHash}.`;
      const evidenceBlock = await prepareWrappedText(evidenceText, {
        size: 7,
        lineHeight: 9,
        maxWidth: contentWidth,
        fonts,
      });
      const requiredHeight = imageHeight + evidenceBlock.lines.length * evidenceBlock.lineHeight + 16;
      if (cursorY - requiredHeight < bottomMargin) await newPage();
      page.drawImage(image, {
        x: margin,
        y: cursorY - imageHeight,
        width: imageWidth,
        height: imageHeight,
      });
      cursorY -= imageHeight + 5;
      cursorY = drawWrappedBlock(page, evidenceBlock, margin, cursorY, rgb(0.18, 0.23, 0.29));
      cursorY -= 8;
    }
  }
}

function regularFontForAppendix(fonts: PdfFontRegistry): PDFFont {
  // The notice is restricted to built-in Helvetica characters. Return the
  // standard regular font without triggering another font-asset fetch.
  return fonts.standardRegular;
}

async function assertExportable(input: MoveInReadyExportInput): Promise<void> {
  if (input.fundingType !== "lahsa") throw new Error("Only the LAHSA workflow can create this export.");
  if (!input.pseudonym.trim()) throw new Error("A unit pseudonym is required before export.");
  if (!input.signoff.attested || !input.signoff.evaluatorName.trim() || !input.signoff.typedSignature.trim()) {
    throw new Error("Evaluator sign-off is required before export.");
  }
  if (!input.evaluatorAgencyName?.trim()) {
    throw new Error("Evaluator agency name is required before export.");
  }
  if (input.landlordDiscussion !== "yes" && input.landlordDiscussion !== "no") {
    throw new Error("Landlord discussion must be recorded as YES or NO before export.");
  }
  if (input.landlordDiscussion === "yes" && !input.landlordDiscussionDate?.trim()) {
    throw new Error("A landlord discussion date is required when the answer is YES.");
  }
  if (input.landlordDiscussion === "yes" && !isValidCalendarDate(input.landlordDiscussionDate)) {
    throw new Error("A valid landlord discussion date is required when the answer is YES.");
  }
  if (input.leadershipSignoffRequired) {
    if (!input.leadershipSignoff?.trim()) {
      throw new Error("Agency leadership sign-off is required before export.");
    }
    if (!input.leadershipNameAndTitle?.trim()) {
      throw new Error("Agency leadership name and title are required before export.");
    }
    if (!isValidCalendarDate(input.leadershipSignedAt)) {
      throw new Error("A valid agency leadership sign-off date is required before export.");
    }
  }
  const finalization = deriveFinalInspectionResult({
    fundingType: input.fundingType,
    capturedRoomIds: input.capturedRoomIds,
    evaluatorDecisions: input.decisions,
    signoff: input.signoff,
  });
  if (finalization.status !== "complete") {
    if (finalization.status === "capture-incomplete") {
      throw new Error(`Every required room video must be captured before export. ${finalization.blockers.join(" ")}`);
    }
    throw new Error("Every element must have a valid evaluator decision and sign-off before export.");
  }
  for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
    const parsed = validateEvaluatorDecision(input.decisions[elementId], elementId);
    if (!parsed.ok) throw new Error("An evaluator decision is invalid.");
    const decision = parsed.value;
    if (decision.status !== "A" && decision.status !== "D") {
      throw new Error("Every element must have a completed evaluator decision before export.");
    }
    if (decision.status === "D") {
      if (decision.evidence.length === 0 || !decision.deficiency.correction.trim()) {
        throw new Error("Every evaluator-confirmed deficiency requires evidence and a correction.");
      }
    }
  }
  if (!validateEvaluatorSignoff(input.signoff).ok) {
    throw new Error("Evaluator sign-off is invalid.");
  }
  await validateReferencedStills(input);
}

function isValidCalendarDate(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value;
}

const MAX_EXPORT_STILL_BYTES = 512 * 1024;
const FONT_ASSET_CACHE = new Map<string, Promise<Uint8Array>>();

async function validateReferencedStills(input: MoveInReadyExportInput): Promise<void> {
  const stillByIdentity = new Map<string, ExportStill>();
  for (const still of input.stills) {
    const key = evidenceKey(still.evidence);
    if (stillByIdentity.has(key)) throw new Error("The export contains duplicate source still identities.");
    stillByIdentity.set(key, still);
  }

  const cited = new Map<string, EvidenceReference>();
  for (const decision of Object.values(input.decisions)) {
    if (decision.status !== "A" && decision.status !== "D") continue;
    for (const reference of decision.evidence) cited.set(evidenceKey(reference), reference);
  }

  for (const [key, reference] of cited) {
    const still = stillByIdentity.get(key);
    if (!still || !sameEvidenceReference(still.evidence, reference)) {
      throw new Error("A cited source video still does not match its full evidence identity.");
    }
    if (still.jpegBytes.byteLength < 3 || still.jpegBytes.byteLength > MAX_EXPORT_STILL_BYTES) {
      throw new Error("A cited source video still has an invalid size.");
    }
    if (still.jpegBytes[0] !== 0xff || still.jpegBytes[1] !== 0xd8 || still.jpegBytes[2] !== 0xff) {
      throw new Error("A cited source video still is not a JPEG.");
    }
    const actualHash = await sha256Hex(still.jpegBytes);
    if (actualHash !== reference.stillHash) {
      throw new Error("A cited source video still does not match its SHA-256 evidence hash.");
    }
  }
}

function sameEvidenceReference(a: EvidenceReference, b: EvidenceReference): boolean {
  return a.schemaVersion === b.schemaVersion &&
    a.catalogVersion === b.catalogVersion &&
    a.videoId === b.videoId &&
    a.videoRevision === b.videoRevision &&
    a.roomId === b.roomId &&
    a.stillId === b.stillId &&
    a.timestampMs === b.timestampMs &&
    a.frameIndex === b.frameIndex &&
    a.stillHash === b.stillHash;
}

function evidenceKey(reference: EvidenceReference): string {
  return [
    reference.schemaVersion,
    reference.catalogVersion,
    reference.videoId,
    reference.videoRevision,
    reference.roomId,
    reference.stillId,
    reference.timestampMs,
    reference.frameIndex,
    reference.stillHash,
  ].join("\u0000");
}

function decisionProvenanceLines(
  decision: Extract<EvaluatorDecision, { status: "A" | "D" }>,
): string[] {
  const lines = [
    `Evaluator decision recorded by: ${decision.evaluatorName}`,
    `Evaluator decision recorded at: ${decision.decidedAt}`,
    `In-person check acknowledged by: ${cleanText(decision.inPersonCheckAcknowledgment.evaluatorName, 120)}`,
    `In-person check completed at: ${decision.inPersonCheckAcknowledgment.completedAt}`,
  ];
  const identity = decision.analysisIdentity;
  if (!identity) return [...lines, "Analysis provenance: manual evaluator review."];
  return [
    ...lines,
    `Analysis identity: session ${identity.sessionId}; room ${identity.roomId}; video ${identity.videoId} revision ${identity.videoRevision}; analysis ${identity.analysisId} attempt ${identity.attempt}; catalog ${identity.catalogVersion}`,
    `Analysis ID: ${identity.analysisId}; attempt ${identity.attempt}; catalog ${identity.catalogVersion}`,
    `Source video SHA-256: ${identity.expectedSourceHash}`,
  ];
}

function evidenceProvenanceLines(evidence: readonly EvidenceReference[]): string[] {
  return evidence.map((reference, index) =>
    `Evidence ${index + 1} provenance: video ${reference.videoId} revision ${reference.videoRevision}; frame ${reference.frameIndex === null ? "local still" : reference.frameIndex}; room ${reference.roomId}; ${reference.timestampMs} ms; still ${reference.stillId}; SHA-256 ${reference.stillHash}`,
  );
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface UnicodeFont {
  regular: PDFFont;
  bold: PDFFont;
  regularSet: Set<number>;
  boldSet: Set<number>;
}

class PdfFontRegistry {
  private readonly regularSet: Set<number>;
  private readonly boldSet: Set<number>;
  private dejavu?: Promise<UnicodeFont>;
  private unifont?: Promise<UnicodeFont>;

  constructor(
    private readonly document: import("pdf-lib").PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.regularSet = new Set(regular.getCharacterSet());
    this.boldSet = new Set(bold.getCharacterSet());
  }

  get standardRegular(): PDFFont {
    return this.regular;
  }

  async forText(value: string, weight: "regular" | "bold"): Promise<PDFFont> {
    const characters = Array.from(value, (character) => character.codePointAt(0)!);
    const builtInSet = weight === "bold" ? this.boldSet : this.regularSet;
    const builtIn = weight === "bold" ? this.bold : this.regular;
    if (characters.every((codePoint) => builtInSet.has(codePoint))) return builtIn;

    const dejavu = await (this.dejavu ??= this.loadUnicodeFont(
      new URL("./assets/DejaVuSans.ttf", import.meta.url),
      new URL("./assets/DejaVuSans-Bold.ttf", import.meta.url),
    ));
    const dejavuSet = weight === "bold" ? dejavu.boldSet : dejavu.regularSet;
    if (characters.every((codePoint) => dejavuSet.has(codePoint))) {
      return weight === "bold" ? dejavu.bold : dejavu.regular;
    }

    const unifont = await (this.unifont ??= this.loadUnicodeFont(
      new URL("../../node_modules/@fontsource/unifont/files/unifont-latin-400-normal.woff2", import.meta.url),
      new URL("../../node_modules/@fontsource/unifont/files/unifont-latin-400-normal.woff2", import.meta.url),
    ));
    const fallback = weight === "bold" ? unifont.boldSet : unifont.regularSet;
    const unsupported = characters.find((codePoint) => !fallback.has(codePoint));
    if (unsupported !== undefined) {
      throw new Error(`The PDF fonts cannot render Unicode code point U+${unsupported.toString(16).toUpperCase()}.`);
    }
    return unifont.regular;
  }

  private async loadUnicodeFont(regularUrl: URL, boldUrl: URL): Promise<UnicodeFont> {
    const fontkitNamespace = await import("@pdf-lib/fontkit");
    const fontkit = (fontkitNamespace as unknown as {
      default: Parameters<import("pdf-lib").PDFDocument["registerFontkit"]>[0];
    }).default;
    if (!fontkit || typeof fontkit.create !== "function") throw new Error("Unicode PDF font support is unavailable.");
    this.document.registerFontkit(fontkit);
    const [regularBytes, boldBytes] = await Promise.all([loadFontAsset(regularUrl), loadFontAsset(boldUrl)]);
    const regularFont = await this.document.embedFont(regularBytes, { subset: true });
    const regularSet = new Set(regularFont.getCharacterSet());
    if (regularUrl.href === boldUrl.href) {
      return {
        regular: regularFont,
        bold: regularFont,
        regularSet,
        boldSet: regularSet,
      };
    }
    const bold = await this.document.embedFont(boldBytes, { subset: true });
    return {
      regular: regularFont,
      bold,
      regularSet,
      boldSet: new Set(bold.getCharacterSet()),
    };
  }
}

async function loadFontAsset(url: URL): Promise<Uint8Array> {
  let asset = FONT_ASSET_CACHE.get(url.href);
  if (!asset) {
    asset = fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error("A required local PDF font could not be loaded.");
        return new Uint8Array(await response.arrayBuffer());
      })
      .catch((error: unknown) => {
        FONT_ASSET_CACHE.delete(url.href);
        throw error;
      });
    FONT_ASSET_CACHE.set(url.href, asset);
  }
  return asset;
}

interface WrappedTextBlock {
  font: PDFFont;
  lines: string[];
  lineHeight: number;
  size: number;
}

async function prepareWrappedText(
  value: string,
  options: {
    size: number;
    lineHeight: number;
    maxWidth: number;
    fonts: PdfFontRegistry;
    weight?: "regular" | "bold";
  },
): Promise<WrappedTextBlock> {
  const text = cleanPdf(value);
  const font = await options.fonts.forText(text, options.weight ?? "regular");
  return {
    font,
    lines: wrapByRenderedWidth(text, font, options.size, options.maxWidth),
    lineHeight: options.lineHeight,
    size: options.size,
  };
}

async function drawWrappedText(
  page: PDFPage,
  value: string,
  options: {
    x: number;
    y: number;
    size: number;
    lineHeight: number;
    maxWidth: number;
    fonts: PdfFontRegistry;
    color: ReturnType<typeof import("pdf-lib").rgb>;
    weight?: "regular" | "bold";
  },
): Promise<number> {
  const block = await prepareWrappedText(value, options);
  return drawWrappedBlock(page, block, options.x, options.y, options.color);
}

function drawWrappedBlock(
  page: PDFPage,
  block: WrappedTextBlock,
  x: number,
  y: number,
  color: ReturnType<typeof import("pdf-lib").rgb>,
): number {
  for (const line of block.lines) {
    page.drawText(line, { x, y, size: block.size, font: block.font, color });
    y -= block.lineHeight;
  }
  return y;
}

async function drawText(
  page: PDFPage,
  value: string,
  options: {
    x: number;
    y: number;
    size: number;
    fonts: PdfFontRegistry;
    color: ReturnType<typeof import("pdf-lib").rgb>;
    weight?: "regular" | "bold";
  },
): Promise<void> {
  const text = cleanPdf(value);
  const font = await options.fonts.forText(text, options.weight ?? "regular");
  page.drawText(text, { x: options.x, y: options.y, size: options.size, font, color: options.color });
}

function wrapByRenderedWidth(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    const graphemes = splitGraphemes(word);
    let piece = "";
    for (const grapheme of graphemes) {
      const next = piece + grapheme;
      if (piece && font.widthOfTextAtSize(next, size) > maxWidth) {
        lines.push(piece);
        piece = grapheme;
      } else {
        piece = next;
      }
    }
    line = piece;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function splitGraphemes(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

function cleanText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanPdf(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim();
}

function titleFor(kind: MoveInReadyExportKind): string {
  if (kind === "client-file") return "Client-file inspection copy";
  if (kind === "landlord-fix-list") return "Landlord fix list";
  return "Form 1083-style HMIS-ready copy";
}

function drawRule(
  page: import("pdf-lib").PDFPage,
  x: number,
  y: number,
  width: number,
  color: import("pdf-lib").Color,
): void {
  page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 1, color });
}

function safeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "inspection";
}

function formatTime(timestampMs: number): string {
  const seconds = Math.floor(Math.max(0, timestampMs) / 1000);
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  return `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
}
