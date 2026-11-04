import { assertInspectionAuth, assertInspectionRequest, boundedInspectionJson, inspectionFailure, inspectionJson } from "../../../../server/inspection/http";
import { deleteInspection, getInspection, saveInspection, validateSessionId } from "../../../../server/inspection/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

async function sessionIdFrom(context: RouteContext): Promise<string> {
  const { sessionId } = await context.params;
  if (!validateSessionId(sessionId)) {
    throw new Response("Not found", { status: 404 });
  }
  return sessionId;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertInspectionRequest(request);
    await assertInspectionAuth(request);
    const sessionId = await sessionIdFrom(context);
    const stored = await getInspection(sessionId);
    if (!stored) return inspectionJson({ ok: true, inspection: null, revision: 0 });
    return inspectionJson({ ok: true, inspection: stored.inspection, revision: stored.revision });
  } catch (error) {
    if (error instanceof Response) return error;
    return inspectionFailure(error);
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertInspectionRequest(request);
    await assertInspectionAuth(request);
    const sessionId = await sessionIdFrom(context);
    const body = await boundedInspectionJson(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return inspectionJson({ ok: false, error: { code: "INVALID_REQUEST", message: "The walkthrough save request is invalid." } }, 400);
    }
    const payload = body as { inspection?: unknown; expectedRevision?: unknown };
    if (!Number.isSafeInteger(payload.expectedRevision) || (payload.expectedRevision as number) < 0 || !("inspection" in payload)) {
      return inspectionJson({ ok: false, error: { code: "INVALID_REQUEST", message: "A valid expected revision and inspection are required." } }, 400);
    }
    const saved = await saveInspection(sessionId, payload.inspection, payload.expectedRevision as number);
    return inspectionJson({ ok: true, inspection: saved.inspection, revision: saved.revision });
  } catch (error) {
    if (error instanceof Response) return error;
    return inspectionFailure(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertInspectionRequest(request);
    await assertInspectionAuth(request);
    const sessionId = await sessionIdFrom(context);
    const deleted = await deleteInspection(sessionId);
    return inspectionJson({ ok: true, deleted });
  } catch (error) {
    if (error instanceof Response) return error;
    return inspectionFailure(error);
  }
}
