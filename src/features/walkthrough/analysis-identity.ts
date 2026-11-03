/**
 * Pure in-flight analysis currency check (OBS-2): an async video response
 * applies only when the live record still matches every identity
 * dimension the request was sent with — session, room, media, and the
 * schema/catalog versions matched independently and exactly. A version
 * bump, room switch, clip replacement, abort, or superseding attempt
 * during flight discards the stale response.
 */

export interface AnalysisCurrencyRecord {
  sessionId: string;
  selectedRoomId: string;
  schemaVersion: number;
  catalogVersion: string;
}

export interface AnalysisCurrencyIdentity {
  schemaVersion: number;
  catalogVersion: string;
  videoId: string;
  videoRevision: number;
  videoHash: string;
}

export interface AnalysisCurrencyExpected {
  sessionId: string;
  roomId: string;
  videoId: string;
  videoRevision: number;
  videoHash: string;
  schemaVersion: number;
  catalogVersion: string;
}

export interface AnalysisCurrencyInput {
  aborted: boolean;
  generation: number;
  currentGeneration: number;
  record: AnalysisCurrencyRecord | null | undefined;
  identity: AnalysisCurrencyIdentity | null | undefined;
  expected: AnalysisCurrencyExpected;
  /**
   * Batch pipelines (Sprint 0 REQ-S2) analyze rooms other than the
   * selected one. They still bind every response to the full media
   * identity (session, room, video, attempt, versions); only the UI
   * selection comparison is skipped. Defaults to true (manual flow).
   */
  requireSelectedRoom?: boolean;
}

export function isAnalysisCurrent(input: AnalysisCurrencyInput): boolean {
  const { record, identity, expected } = input;
  const selectionCurrent = input.requireSelectedRoom === false ||
    record?.selectedRoomId === expected.roomId;
  return !input.aborted && input.generation === input.currentGeneration && Boolean(
    selectionCurrent && record && identity &&
    record.sessionId === expected.sessionId &&
    record.schemaVersion === expected.schemaVersion && record.catalogVersion === expected.catalogVersion &&
    identity.schemaVersion === expected.schemaVersion && identity.catalogVersion === expected.catalogVersion &&
    identity.videoId === expected.videoId && identity.videoRevision === expected.videoRevision &&
    identity.videoHash === expected.videoHash,
  );
}
