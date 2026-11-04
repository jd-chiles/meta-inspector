import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

function bad(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

function isValidEmail(email: string): boolean {
  // RFC-simple: no spaces, one @, has dot after
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

export async function POST(request: NextRequest) {
  // Leads is low-risk (no billing, no PII retrieval) — allow same-origin + loopback + configured public origin.
  // Use shared check, but also explicitly allow loopback origins even when request.url is the public origin (reverse proxy case).
  const { checkAppOrigin } = await import("../../../server/request-origin");
  const originCheck = checkAppOrigin(request, process.env.APP_PUBLIC_ORIGIN);
  if (!originCheck.allowed) {
    // Fallback: allow loopback origins directly (covers proxy rewriting request.url to public origin)
    const origin = request.headers.get("origin") ?? "";
    try {
      const o = new URL(origin);
      const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
      const host = o.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (!loopback.has(host)) throw new Error("not loopback");
    } catch {
      return bad(403, "ORIGIN_FORBIDDEN", "Cross-origin requests are rejected.");
    }
  }
  if (originCheck.configError) return bad(503, "SETUP_REQUIRED", "The server origin is misconfigured.");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return bad(400, "INVALID_REQUEST", "Send JSON.");
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return bad(400, "INVALID_REQUEST", "Could not read request.");
  }
  if (raw.length > 8192) return bad(413, "INVALID_REQUEST", "Request too large.");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return bad(400, "INVALID_REQUEST", "Invalid JSON.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return bad(400, "INVALID_REQUEST", "Invalid payload.");
  const r = data as Record<string, unknown>;

  // Allowlist keys — address fields are NEVER accepted here (privacy)
  const allowed = new Set(["email", "name", "org", "phone", "consent", "source", "zip5", "ownerChecked"]);
  for (const k of Object.keys(r)) if (!allowed.has(k)) return bad(400, "INVALID_REQUEST", `Unexpected field: ${k}`);

  const email = clean(r.email, 254);
  if (!email || !isValidEmail(email)) return bad(400, "INVALID_REQUEST", "Enter a valid email.");

  const name = typeof r.name === "string" ? r.name.trim().slice(0, 100) : "";
  const org = typeof r.org === "string" ? r.org.trim().slice(0, 100) : "";
  const phone = typeof r.phone === "string" ? r.phone.trim().slice(0, 20) : "";
  const consent = r.consent === true;
  if (!consent) return bad(400, "INVALID_REQUEST", "Please confirm you agree to be contacted about WalkthroughKit.");

  // Honeypot / rate soft: phone must not look like obvious spam fill
  // We accept any value under 20 chars — validation is permissive for MVP

  const source = typeof r.source === "string" ? r.source.trim().slice(0, 40) : "landing-prescreen";
  const zip5 = typeof r.zip5 === "string" && /^\d{5}$/.test(r.zip5.trim()) ? r.zip5.trim() : "";
  const ownerChecked = r.ownerChecked === true;

  const now = new Date().toISOString();
  const ua = request.headers.get("user-agent")?.slice(0, 200) ?? "";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 45) ?? "";

  const lead = {
    createdAt: now,
    email: email.toLowerCase(),
    name: name || null,
    org: org || null,
    phone: phone || null,
    consent,
    source,
    // Coarse geo/intent only — never street/city/state
    zip5: zip5 || null,
    ownerChecked,
    ua: ua || null,
    ip: ip || null,
  };

  // Persist: file append (VPS durable) + optional log. Never persisted: address, owner name.
  // File lives beside repo data/ — gitignored, backed up separately.
  try {
    const dir = path.join(process.cwd(), "data");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "leads.jsonl");
    await fs.appendFile(file, JSON.stringify(lead) + "\n", "utf8");
  } catch (e) {
    // If file write fails (e.g., read-only FS on ACA), log server-side only — still return success
    // so lead capture does not block prescreen. Do not leak path.
    console.error("[leads] file append failed", e);
  }

  // Optional: forward to webhook if configured (server-only). Fire-and-forget, no PII in logs.
  const webhook = process.env.LEADS_WEBHOOK_URL?.trim();
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
      });
    } catch {
      // silent — file is source of truth
    }
  }

  return Response.json({ ok: true }, { status: 200 });
}
