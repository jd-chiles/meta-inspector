/** True when this browser can share files (mobile share sheet: message or email the packet to yourself). Render-gated so desktop never shows a dead button. */
export function canShareExportFiles(navigatorLike?: unknown): boolean {
  try {
    const nav = (navigatorLike ?? (typeof navigator === "undefined" ? undefined : navigator)) as
      | { canShare?: (data: { files: File[] }) => boolean }
      | undefined;
    if (!nav || typeof nav.canShare !== "function" || typeof File === "undefined") return false;
    return nav.canShare({ files: [new File(["share-probe"], "share-probe.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}
