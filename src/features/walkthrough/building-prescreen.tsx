"use client";

/**
 * Building pre-screen card (REQ-R1, illustrative-first). Default behavior is
 * required: an explainer plus a clearly labeled EXAMPLE result for the
 * literal demo address only. Any other address answers that the live check
 * is not connected — fixture data is never presented as a real building's
 * record (rules 2/4). No live LAHD query is wired: the official
 * code-enforcement dataset was not verified against data.lacity.org this
 * sprint, so there is no LAHD_PRESCREEN_LIVE path.
 */
import { useState } from "react";

/** The only address with an (illustrative) answer. */
export const DEMO_PRESREEN_ADDRESS = "123 Demo St (example)";

/** Banner shown with every illustrative answer. */
export const PRESCREEN_ILLUSTRATIVE_BANNER = "Illustrative example — live records not connected.";

/** Answer for any non-demo address in default mode. */
export const PRESCREEN_NOT_CONNECTED = "Live check not connected for this address.";

export type PrescreenDecision =
  | { kind: "empty" }
  | { kind: "example" }
  | { kind: "not-connected" };

/** Pure address routing: demo literal → example, blank → explainer, else not-connected. */
export function prescreenDecisionForAddress(address: string): PrescreenDecision {
  const normalized = address.trim().toLowerCase();
  if (normalized.length === 0) return { kind: "empty" };
  if (normalized === DEMO_PRESREEN_ADDRESS.toLowerCase()) return { kind: "example" };
  return { kind: "not-connected" };
}

export default function BuildingPrescreen(): React.JSX.Element {
  const [address, setAddress] = useState("");
  const [decision, setDecision] = useState<PrescreenDecision>({ kind: "empty" });
  // The query is never persisted or sent anywhere: addresses stay out of the
  // staged inspection record by design.
  return (
    <div data-testid="building-prescreen">
      <p>
        Check whether a building has open habitability cases before you visit. Live
        records are not connected in this demo.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setDecision(prescreenDecisionForAddress(address));
        }}
      >
        <label htmlFor="prescreen-address">Building address</label>
        <input
          id="prescreen-address"
          data-testid="prescreen-address"
          value={address}
          maxLength={200}
          placeholder={DEMO_PRESREEN_ADDRESS}
          autoComplete="off"
          onChange={(event) => setAddress(event.currentTarget.value)}
        />
        <button type="submit" data-testid="prescreen-check">
          Check building
        </button>
      </form>
      {decision.kind !== "empty" && (
        <div data-testid="prescreen-result" role="status">
          {decision.kind === "example" ? (
            <>
              <p><strong>{PRESCREEN_ILLUSTRATIVE_BANNER}</strong></p>
              <p>Example result for {DEMO_PRESREEN_ADDRESS}:</p>
              <ul>
                <li>Open code-enforcement cases (example): 2</li>
                <li>Oldest open case (example): peeling paint, opened 2024-05-01</li>
                <li>Last inspection (example): 2024-05-01 — passed with 1 minor correction</li>
              </ul>
            </>
          ) : (
            <p>{PRESCREEN_NOT_CONNECTED}</p>
          )}
        </div>
      )}
    </div>
  );
}
