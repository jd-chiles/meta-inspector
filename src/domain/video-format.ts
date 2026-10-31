/** Bounded ISO-BMFF brands accepted by the browser and server video paths. */
export const MAX_FTYP_BOX_BYTES = 4 * 1024;
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
