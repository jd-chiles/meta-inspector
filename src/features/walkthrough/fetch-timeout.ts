/** Bounded fetch for long provider calls. A stalled upload or model run must surface as a retryable error, never hang the batch forever. */

/** Upload + server processing budget per stage. Staged clips segment in ~2 min; real takes run longer. */
export const SEGMENT_TIMEOUT_MS = 300_000;
export const MAP_TIMEOUT_MS = 240_000;
/** Stills-first analysis: one vision call per room, so the budget is 90 s. */
export const STILLS_TIMEOUT_MS = 90_000;

export class FetchTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`The request did not finish within ${Math.round(timeoutMs / 60000)} minutes.`);
    this.name = "FetchTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * fetch() that aborts after timeoutMs with FetchTimeoutError. An existing
 * parent signal still cancels first (user cancel, new analysis); its abort
 * propagates as the parent's own error, not a timeout.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const parent = init.signal ?? null;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onParentAbort = () => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new FetchTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  }
}
