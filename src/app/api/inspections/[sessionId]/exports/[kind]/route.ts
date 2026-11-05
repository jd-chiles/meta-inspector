import { assertInspectionAuth, assertInspectionRequest, inspectionFailure, inspectionJson } from "../../../../../../server/inspection/http";
import { getInspection, validateSessionId } from "../../../../../../server/inspection/store";
import { buildInspectionExport, InspectionExportError, type InspectionExportKind } from "../../../../../../server/exports/build-inspection-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string; kind: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertInspectionRequest(request);
    await assertInspectionAuth(request);
    const { sessionId, kind } = await context.params;
    if (!validateSessionId(sessionId)) return inspectionJson({ ok: false, error: { code: "NOT_FOUND", message: "Walkthrough not found." } }, 404);
    const stored = await getInspection(sessionId);
    if (!stored) return inspectionJson({ ok: false, error: { code: "NOT_FOUND", message: "Walkthrough not found." } }, 404);
    const result = await buildInspectionExport(stored.inspection, kind as InspectionExportKind);
    return new Response(result.bytes, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Length": String(result.bytes.byteLength),
        "Cache-Control": "no-store, private, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof InspectionExportError) {
      return inspectionJson({ ok: false, error: { code: "EXPORT_UNAVAILABLE", message: error.message } }, error.status);
    }
    return inspectionFailure(error);
  }
}
