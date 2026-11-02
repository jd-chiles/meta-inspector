"use client";

import { useState, type FormEvent } from "react";

export default function UnlockPage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          typeof body === "object" && body !== null &&
          typeof (body as { error?: { message?: unknown } }).error?.message === "string"
            ? String((body as { error: { message: string } }).error.message)
            : "Wrong passcode.";
        setError(message);
        return;
      }
      window.location.replace("/");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={pageStyle} data-testid="unlock-page">
      <form onSubmit={onSubmit} style={cardStyle}>
        <h1 style={titleStyle}>MetaInspect Pilot</h1>
        <p style={subStyle}>Enter the inspection passcode to continue.</p>
        <input
          type="password"
          autoComplete="off"
          autoFocus
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          placeholder="Passcode"
          aria-label="Passcode"
          style={inputStyle}
        />
        {error ? <p role="alert" style={errorStyle}>{error}</p> : null}
        <button type="submit" disabled={busy || passcode.length === 0} style={buttonStyle}>
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: "#0f172a",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 360,
  background: "#ffffff",
  borderRadius: 16,
  padding: 28,
  boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
};

const titleStyle: React.CSSProperties = { margin: 0, fontSize: 22, color: "#0f172a" };
const subStyle: React.CSSProperties = { marginTop: 8, color: "#475569", fontSize: 14 };
const inputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 16,
  padding: "12px 14px",
  fontSize: 16,
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
};
const errorStyle: React.CSSProperties = { color: "#b91c1c", fontSize: 14, marginTop: 12 };
const buttonStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 16,
  padding: "12px 14px",
  fontSize: 16,
  fontWeight: 600,
  borderRadius: 10,
  border: "none",
  background: "#2563eb",
  color: "#ffffff",
  cursor: "pointer",
};
