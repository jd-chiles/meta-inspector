export type VideoSegmentErrorCode =
  | "SETUP_REQUIRED"
  | "INVALID_REQUEST"
  | "VIDEO_TOO_LARGE"
  | "VIDEO_TOO_LONG"
  | "UNSUPPORTED_VIDEO"
  | "INVALID_VIDEO"
  | "UNSUPPORTED_STILL"
  | "STALE_REQUEST"
  | "OPERATION_BUSY"
  | "PROCESSING_BUSY"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_FAILURE"
  | "INVALID_MODEL_OUTPUT";

export class VideoSegmentError extends Error {
  constructor(
    readonly status: 400 | 409 | 411 | 413 | 415 | 422 | 429 | 502 | 503 | 504,
    readonly code: VideoSegmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VideoSegmentError";
  }
}
