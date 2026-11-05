/**
 * Two-room batch scheduler (Sprint 0 REQ-S2/REQ-S5). Pure, React-free so
 * the interleaved-room accounting is unit-testable: each settled result
 * is attributed to the room whose pipeline produced it, never by
 * completion order, and cancel/offline stops launching new rooms while
 * in-flight rooms settle normally.
 */

/** Max concurrent analyzeRoom pipelines in one batch (matches the server's two admission slots). */
export const MAX_CONCURRENT_BATCH_ROOMS = 3;

export interface RoomBatchQueue<RoomId> {
  enqueue(roomId: RoomId): boolean;
  takeNext(): RoomId | undefined;
  has(roomId: RoomId): boolean;
  clear(): void;
  readonly size: number;
  snapshot(): RoomId[];
}

/**
 * Deduplicated FIFO of rooms awaiting analysis. The batch pool pulls via
 * takeNext (so analyze-on-save rooms enqueued mid-run join this run);
 * enqueue returns false when the room is already queued.
 */
export function createRoomBatchQueue<RoomId>(initial: readonly RoomId[] = []): RoomBatchQueue<RoomId> {
  const pending: RoomId[] = [...initial];
  return {
    enqueue(roomId: RoomId): boolean {
      if (pending.includes(roomId)) return false;
      pending.push(roomId);
      return true;
    },
    takeNext(): RoomId | undefined {
      return pending.shift();
    },
    has(roomId: RoomId): boolean {
      return pending.includes(roomId);
    },
    clear(): void {
      pending.length = 0;
    },
    get size(): number {
      return pending.length;
    },
    snapshot(): RoomId[] {
      return [...pending];
    },
  };
}

export interface RoomBatchOutcome<RoomId> {
  /** Rooms whose pipeline proved a current proposal, in settle order. */
  proved: RoomId[];
  /** Rooms whose pipeline did not prove one, in settle order. */
  failed: RoomId[];
}

export interface RunRoomBatchOptions<RoomId> {
  queue: RoomBatchQueue<RoomId>;
  maxConcurrent?: number;
  /** Checked before launching each room; in-flight rooms still settle. */
  shouldStop?: () => boolean;
  /** Room pipeline. Resolves true only when a current proposal was proved for that room. */
  runRoom: (roomId: RoomId) => Promise<boolean>;
  onRoomSettled?: (roomId: RoomId, proved: boolean) => void;
}

/**
 * Run room pipelines with at most maxConcurrent in flight. Workers pull
 * rooms from the shared queue, so a slow room never blocks a fast one
 * and results always land on the room that produced them.
 */
export async function runRoomBatch<RoomId>(options: RunRoomBatchOptions<RoomId>): Promise<RoomBatchOutcome<RoomId>> {
  const { queue, runRoom, onRoomSettled } = options;
  const maxConcurrent = Math.min(
    Math.max(1, Math.floor(options.maxConcurrent ?? MAX_CONCURRENT_BATCH_ROOMS)),
    8,
  );
  const shouldStop = options.shouldStop ?? (() => false);
  const proved: RoomId[] = [];
  const failed: RoomId[] = [];
  const workers = Array.from({ length: maxConcurrent }, async () => {
    for (;;) {
      if (shouldStop()) return;
      const roomId = queue.takeNext();
      if (roomId === undefined) return;
      let roomProved = false;
      try {
        roomProved = await runRoom(roomId);
      } catch {
        roomProved = false;
      }
      (roomProved ? proved : failed).push(roomId);
      onRoomSettled?.(roomId, roomProved);
    }
  });
  await Promise.all(workers);
  return { proved, failed };
}

/** Plain inputs for the analyze-on-save gate (Sprint 0 REQ-S5). */
export interface AutoEnqueueOnSaveInput {
  walkthroughAttested: boolean;
  walkthroughSendConsent: boolean;
  batchAttested: boolean;
  batchSendConsent: boolean;
  analysisMode: string;
  online: boolean;
  /** A manual single-room pipeline is currently segmenting/mapping. */
  manualPipelineInFlight: boolean;
  /** Unresolved batch failures await explicit review. */
  hasUnresolvedBatchFailures: boolean;
  /** Stored clip MIME; MOV (video/quicktime) is server-rejected. */
  mime: string;
  /** The saved record still belongs to this clip's session. */
  sessionMatches: boolean;
  fundingType: string;
  hasCurrentProposal: boolean;
  queuedInBatch: boolean;
  analysisInFlight: boolean;
}

/**
 * Analyze-on-save gate (Sprint 0 REQ-S5): a saved room clip enqueues for
 * immediate analysis only with tour + batch consent, LAHSA funding, live
 * mode, and a connection — deduped against proved/queued/in-flight rooms,
 * skipped while a manual run is in flight, while unresolved failures
 * await review, and for MOV clips. Offline (or unconsented) saves
 * enqueue nothing here; Sprint 3's persisted queue covers them.
 */
export function shouldAutoEnqueueOnSave(input: AutoEnqueueOnSaveInput): boolean {
  return (
    input.walkthroughAttested &&
    input.walkthroughSendConsent &&
    input.batchAttested &&
    input.batchSendConsent &&
    input.analysisMode === "live" &&
    input.online &&
    !input.manualPipelineInFlight &&
    !input.hasUnresolvedBatchFailures &&
    input.mime !== "video/quicktime" &&
    input.sessionMatches &&
    input.fundingType === "lahsa" &&
    !input.hasCurrentProposal &&
    !input.queuedInBatch &&
    !input.analysisInFlight
  );
}
