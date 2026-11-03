/** Bounded ISO-BMFF brands accepted by the browser and server video paths. */
export const MAX_FTYP_BOX_BYTES = 4 * 1024;
/**
 * Analysis window (Sprint 0 REQ-S3): server-side analysis (frames, SAM,
 * retained stills) uses only the first 30 seconds of a room clip. The
 * stored original is untouched; evidence at or beyond the cap is dropped.
 */
export const ANALYSIS_CLIP_CAP_SECONDS = 30;
export const ANALYSIS_CLIP_CAP_MS = ANALYSIS_CLIP_CAP_SECONDS * 1000;
/** Plain-language analysis-window copy shared by the segment response and the tour analyze node. */
export const ANALYSIS_WINDOW_NOTE = "Analysis uses the first 30 seconds — film the shot list, then stop.";
/** Maximum distance between a signed one-fps sample target and its decoded source timestamp. */
export const VIDEO_SAMPLE_TIMESTAMP_TOLERANCE_MS = 250;
export const QUICKTIME_BRAND = "qt  ";

export const SUPPORTED_MP4_BRANDS = [
  "isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42",
  "avc1", "M4V ", "dash", "cmfc", "cmfs", "3gp4", "3gp5", "3g2a",
] as const;

export function isSupportedMp4Brand(brand: string): boolean {
  return (SUPPORTED_MP4_BRANDS as readonly string[]).includes(brand);
}
