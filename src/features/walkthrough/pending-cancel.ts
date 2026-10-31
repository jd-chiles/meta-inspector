import type { VideoIdentityFields } from "./move-in-ready-flow";

/**
 * Tracks one outstanding server-held video mapping lease for unload-safe
 * cleanup. When the tab closes between a successful segment response and
 * map completion, no component cleanup runs; the server lease would hold
 * the session busy until its 15-minute token expiry. The pagehide handler
 * consumes this payload and fires the idempotent keepalive stage=cancel.
 * Lease expiry remains the fallback if the browser cannot send it.
 */
export interface PendingCancelPayload {
  identity: VideoIdentityFields;
  token: string | null;
}

export interface PendingCancelTracker {
  set(identity: VideoIdentityFields, token: string | null): void;
  consume(): PendingCancelPayload | null;
  clear(): void;
  hasPending(): boolean;
}

export function createPendingCancelTracker(): PendingCancelTracker {
  let pending: PendingCancelPayload | null = null;
  return {
    set(identity: VideoIdentityFields, token: string | null): void {
      pending = { identity, token };
    },
    consume(): PendingCancelPayload | null {
      const current = pending;
      pending = null;
      return current;
    },
    clear(): void {
      pending = null;
    },
    hasPending(): boolean {
      return pending !== null;
    },
  };
}
