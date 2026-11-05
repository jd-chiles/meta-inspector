import type { EvidenceReference, MoveInReadyRoomId, VideoAnalysisIdentity } from "../../domain/move-in-ready";
import type { MoveInReadyInspection, StoredRoomClipIdentity } from "../../features/walkthrough/inspection-store";
import { buildHmisReadyJson, buildMoveInReadyPdf, type HmisReadyJson, type MoveInReadyExportKind } from "../../export/move-in-ready-pdf";
import { getVerifiedR2Bytes } from "../jobs/r2-bytes";
import { getVideoEvidenceObjectByOrdinal, getVideoJob, type VideoJobRow } from "../jobs/video-job-store";
import { createR2Storage, type R2Storage } from "../storage/r2";

export type InspectionExportKind = MoveInReadyExportKind | "hmis-ready-json";

export class InspectionExportError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "InspectionExportError";
  }
}

export interface InspectionExportDependencies {
  getVideoJob: typeof getVideoJob;
  getVideoEvidenceObjectByOrdinal: typeof getVideoEvidenceObjectByOrdinal;
  storage: R2Storage;
}

const MAX_EVIDENCE_BYTES = 512 * 1024;
const HASH = /^[0-9a-f]{64}$/;

/** Build export bytes using only server-saved inspection state and DB-owned R2 locators. */
export async function buildInspectionExport(
  inspection: MoveInReadyInspection,
  kind: InspectionExportKind,
  dependencies?: InspectionExportDependencies,
): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
  if (!isExportKind(kind)) throw new InspectionExportError(404, "Export format not found.");
  const services = dependencies ?? {
    getVideoJob,
    getVideoEvidenceObjectByOrdinal,
    storage: createR2Storage(),
  };
  const capturedRoomIds = await verifiedCapturedRooms(inspection, services);
  const stills = await loadReferencedStills(inspection, services);
  const input = {
    sessionId: inspection.sessionId,
    pseudonym: inspection.pseudonym,
    fundingType: inspection.fundingType,
    capturedRoomIds,
    expectedRoomIds: inspection.roomIds,
    decisions: inspection.decisions,
    signoff: inspection.signoff!,
    participantSignoff: inspection.participantSignoff!,
    evaluatorAgencyName: inspection.evaluatorAgencyName,
    landlordDiscussion: inspection.landlordDiscussion === "" ? undefined : inspection.landlordDiscussion,
    landlordDiscussionDate: inspection.landlordDiscussionDate,
    leadershipSignoffRequired: inspection.leadershipSignoffRequired,
    leadershipNameAndTitle: inspection.leadershipNameAndTitle,
    leadershipSignoff: inspection.leadershipSignoff,
    leadershipSignedAt: inspection.leadershipSignedAt,
    stills,
  };

  try {
    const generatedAt = new Date().toISOString();
    if (kind === "hmis-ready-json") {
      const json: HmisReadyJson = await buildHmisReadyJson(input);
      return {
        bytes: new TextEncoder().encode(JSON.stringify(json, null, 2)),
        contentType: "application/json; charset=utf-8",
        filename: `move-in-ready-hmis-ready-${safeFilename(inspection.sessionId)}-${filenameTimestamp(generatedAt)}.json`,
      };
    }
    const bytes = await buildMoveInReadyPdf(input, kind);
    return {
      bytes,
      contentType: "application/pdf",
      filename: `move-in-ready-${kind}-${safeFilename(inspection.sessionId)}-${filenameTimestamp(generatedAt)}.pdf`,
    };
  } catch (error) {
    if (error instanceof InspectionExportError) throw error;
    throw new InspectionExportError(422, "The saved walkthrough is not ready to export. Complete required room capture, evaluator decisions, evidence, and sign-off first.");
  }
}

function isExportKind(value: string): value is InspectionExportKind {
  return value === "client-file" || value === "landlord-fix-list" || value === "hmis-ready" || value === "hmis-ready-json";
}

export async function verifiedCapturedRooms(
  inspection: MoveInReadyInspection,
  dependencies: InspectionExportDependencies,
): Promise<MoveInReadyRoomId[]> {
  const rooms: MoveInReadyRoomId[] = [];
  for (const roomId of inspection.roomIds) {
    const clip = inspection.clipIdentities[roomId];
    if (!clip?.jobId) continue;
    const job = await dependencies.getVideoJob(clip.jobId);
    if (job && currentJobMatches(inspection, roomId, clip, job) && isUsableCapturedJob(job.status)) rooms.push(roomId);
  }
  return rooms;
}

async function loadReferencedStills(
  inspection: MoveInReadyInspection,
  dependencies: InspectionExportDependencies,
): Promise<Array<{ evidence: EvidenceReference; jpegBytes: Uint8Array }>> {
  const unique = new Map<string, EvidenceReference>();
  for (const decision of Object.values(inspection.decisions)) {
    if (decision.status !== "A" && decision.status !== "D") continue;
    if (decision.analysisIdentity) {
      for (const evidence of decision.evidence) assertCurrentEvidenceIdentity(inspection, evidence, decision.analysisIdentity);
    }
    for (const evidence of decision.evidence) unique.set(evidenceKey(evidence), evidence);
  }

  const stills = [];
  for (const evidence of unique.values()) {
    const clip = inspection.clipIdentities[evidence.roomId];
    if (!clip?.jobId || !sameClipIdentity(clip, evidence)) {
      throw new InspectionExportError(422, "A cited evidence still is not attached to the current room video.");
    }
    const job = await dependencies.getVideoJob(clip.jobId);
    if (!job || job.status !== "completed" || !currentJobMatches(inspection, evidence.roomId, clip, job)) {
      throw new InspectionExportError(422, "A cited evidence still is no longer available for this walkthrough.");
    }
    const locator = parseEvidenceLocator(evidence.sourceUrl);
    if (!locator || locator.jobId !== job.id) {
      throw new InspectionExportError(422, "A cited evidence still does not have a valid locator for this room video.");
    }
    const object = await dependencies.getVideoEvidenceObjectByOrdinal(job.id, locator.ordinal);
    if (!object || object.sha256 !== evidence.stillHash || !HASH.test(object.sha256) ||
        !Number.isSafeInteger(object.byteLength) || object.byteLength < 3 || object.byteLength > MAX_EVIDENCE_BYTES) {
      throw new InspectionExportError(422, "A cited evidence still could not be verified.");
    }
    let jpegBytes: Uint8Array;
    try {
      jpegBytes = await getVerifiedR2Bytes(dependencies.storage, object.objectKey, MAX_EVIDENCE_BYTES, {
        contentLength: object.byteLength,
        contentType: "image/jpeg",
        sha256: evidence.stillHash,
      });
    } catch {
      throw new InspectionExportError(422, "A cited evidence still could not be verified.");
    }
    if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8 || jpegBytes[2] !== 0xff) {
      throw new InspectionExportError(422, "A cited evidence still is not a valid JPEG.");
    }
    stills.push({ evidence, jpegBytes });
  }
  return stills;
}

type CloudClipIdentity = StoredRoomClipIdentity & { analysisId?: string; attempt?: number };

function currentJobMatches(
  inspection: MoveInReadyInspection,
  roomId: MoveInReadyRoomId,
  clip: CloudClipIdentity,
  job: VideoJobRow,
): boolean {
  return job.sessionId === inspection.sessionId && job.roomId === roomId &&
    job.identity.sessionId === inspection.sessionId &&
    job.identity.schemaVersion === clip.schemaVersion &&
    job.identity.videoId === clip.videoId && job.identity.videoRevision === clip.videoRevision &&
    job.identity.catalogVersion === clip.catalogVersion &&
    job.identity.expectedVideoSha256 === clip.videoHash &&
    typeof clip.analysisId === "string" && job.identity.analysisId === clip.analysisId &&
    Number.isSafeInteger(clip.attempt) && job.identity.attempt === clip.attempt;
}

function isUsableCapturedJob(status: VideoJobRow["status"]): boolean {
  return status === "ready" || status === "queued" || status === "segmenting" || status === "mapping" ||
    status === "completed" || status === "failed" || status === "ambiguous";
}

function parseEvidenceLocator(value: string | undefined): { jobId: string; ordinal: number } | null {
  if (!value) return null;
  const match = /^\/api\/video\/jobs\/([A-Za-z0-9_-]{8,128})\/evidence\/(\d{1,3})$/.exec(value);
  if (!match?.[1] || !match[2]) return null;
  const ordinal = Number(match[2]);
  return Number.isSafeInteger(ordinal) && ordinal <= 100 ? { jobId: match[1], ordinal } : null;
}

function sameClipIdentity(clip: StoredRoomClipIdentity, evidence: EvidenceReference): boolean {
  return clip.schemaVersion === evidence.schemaVersion && clip.catalogVersion === evidence.catalogVersion &&
    clip.videoId === evidence.videoId && clip.videoRevision === evidence.videoRevision &&
    clip.roomId === evidence.roomId && clip.evidence.some((item) => item.stillId === evidence.stillId && item.stillHash === evidence.stillHash);
}

function assertCurrentEvidenceIdentity(
  inspection: MoveInReadyInspection,
  evidence: EvidenceReference,
  identity: VideoAnalysisIdentity,
): void {
  const clip = inspection.clipIdentities[evidence.roomId] as CloudClipIdentity | undefined;
  if (!clip || identity.sessionId !== inspection.sessionId || identity.roomId !== evidence.roomId ||
      identity.schemaVersion !== clip.schemaVersion || identity.videoId !== clip.videoId || identity.videoRevision !== clip.videoRevision ||
      identity.expectedSourceHash !== clip.videoHash || identity.analysisId !== clip.analysisId ||
      identity.attempt !== clip.attempt || identity.catalogVersion !== clip.catalogVersion ||
      evidence.schemaVersion !== clip.schemaVersion || evidence.videoId !== clip.videoId || evidence.videoRevision !== clip.videoRevision) {
    throw new InspectionExportError(422, "A cited evidence still belongs to an older room video or analysis.");
  }
}

function evidenceKey(evidence: EvidenceReference): string {
  return `${evidence.roomId}\0${evidence.videoId}\0${evidence.videoRevision}\0${evidence.stillId}\0${evidence.stillHash}`;
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128) || "inspection";
}

function filenameTimestamp(value: string): string {
  return value.replace(/[^0-9T]/g, "-").replace(/-+$/, "");
}
