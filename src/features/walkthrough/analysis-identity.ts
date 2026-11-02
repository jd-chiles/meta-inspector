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
}

export function isAnalysisCurrent(input: AnalysisCurrencyInput): boolean {
  const { record, identity, expected } = input;
  return !input.aborted && input.generation === input.currentGeneration && Boolean(
    record && identity &&
    record.sessionId === expected.sessionId && record.selectedRoomId === expected.roomId &&
    record.schemaVersion === expected.schemaVersion && record.catalogVersion === expected.catalogVersion &&
    identity.schemaVersion === expected.schemaVersion && identity.catalogVersion === expected.catalogVersion &&
    identity.videoId === expected.videoId && identity.videoRevision === expected.videoRevision &&
    identity.videoHash === expected.videoHash,
  );
}
