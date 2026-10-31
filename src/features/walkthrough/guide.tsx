"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { GUIDE_ACTIONS, type GuideAction, type GuideStage } from "../../domain/guide";

interface GuideResponse {
  mode: "fixture" | "live";
  prompt: string;
  guide: { message: string; actionPlan: string[] };
  fixtureNotice?: string;
}

interface GuideMessage extends GuideResponse {
  id: number;
}

function actionLabel(action: GuideAction): string {
  switch (action) {
    case "next": return "Next step";
    case "photo": return "Photo tips";
    case "check": return "Physical check";
    case "correction": return "Record a correction";
  }
}

function parseGuideResponse(value: unknown): GuideResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if ((record.mode !== "fixture" && record.mode !== "live") || typeof record.prompt !== "string") return null;
  if (typeof record.guide !== "object" || record.guide === null) return null;
  const guide = record.guide as Record<string, unknown>;
  if (typeof guide.message !== "string" || !Array.isArray(guide.actionPlan)) return null;
  if (!guide.actionPlan.every((action) => typeof action === "string")) return null;
  return {
    mode: record.mode,
    prompt: record.prompt,
    guide: { message: guide.message, actionPlan: guide.actionPlan as string[] },
    fixtureNotice: typeof record.fixtureNotice === "string" ? record.fixtureNotice : undefined,
  };
}

export interface GuidePanelProps {
  itemId: string;
  stage: GuideStage;
  initialMessage: string;
  children?: ReactNode;
}

/** State-aware guide chat; explicit prompt buttons are the only model input. */
export default function GuidePanel({ itemId, stage, initialMessage, children }: GuidePanelProps) {
  const [messages, setMessages] = useState<GuideMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const activeItemId = useRef(itemId);
  const controller = useRef<AbortController | null>(null);
  activeItemId.current = itemId;

  useEffect(() => {
    requestSequence.current += 1;
    controller.current?.abort();
    controller.current = null;
    setMessages([]);
    setPending(false);
    setError(null);
    return () => {
      requestSequence.current += 1;
      controller.current?.abort();
    };
  }, [itemId]);

  async function ask(action: GuideAction): Promise<void> {
    const sequence = ++requestSequence.current;
    controller.current?.abort();
    const abortController = new AbortController();
    controller.current = abortController;
    const requestingItem = itemId;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: requestingItem, action, stage }),
        signal: abortController.signal,
      });
      const body = (await response.json()) as unknown;
      if (sequence !== requestSequence.current || activeItemId.current !== requestingItem) return;
      if (!response.ok) {
        const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
        const nested = typeof record.error === "object" && record.error !== null ? record.error as Record<string, unknown> : {};
        throw new Error(typeof nested.message === "string" ? nested.message : "The guide could not answer. Try again when connected.");
      }
      const parsed = parseGuideResponse(body);
      if (!parsed) throw new Error("The guide returned an unusable response. Your walkthrough progress is unchanged.");
      setMessages((current) => [...current, { ...parsed, id: sequence }]);
    } catch (caught) {
      if (abortController.signal.aborted || sequence !== requestSequence.current || activeItemId.current !== requestingItem) return;
      setError(caught instanceof Error ? caught.message : "The guide is unavailable. Your walkthrough progress is unchanged.");
    } finally {
      if (sequence === requestSequence.current && activeItemId.current === requestingItem) setPending(false);
    }
  }

  return (
    <aside className="wt-guide-panel" aria-labelledby="guide-heading">
      <div className="wt-guide-title">
        <span className="wt-guide-avatar" aria-hidden="true">G</span>
        <div><p className="wt-card-kicker">Walkthrough guide</p><h3 id="guide-heading">Your next step</h3></div>
      </div>
      <div className="wt-chat-history" aria-live="polite" data-testid="guide-chat">
        <p className="wt-guide-message" data-testid="guide-initial-message">{initialMessage}</p>
        {messages.map((entry) => (
          <article className="wt-chat-turn" key={entry.id} data-testid="guide-turn">
            <p className="wt-chat-user">{entry.prompt}</p>
            <div className="wt-guide-message">
              <p>{entry.guide.message}</p>
              <span className="wt-artifact-label">{entry.mode === "fixture" ? "Guide draft · fixture" : "Guide draft · AI suggested"}</span>
              <ol className="wt-guide-plan" data-testid="guide-action-artifact">
                {entry.guide.actionPlan.map((step, index) => <li key={index}>{step}</li>)}
              </ol>
              {entry.fixtureNotice && <p className="wt-guide-disclaimer">{entry.fixtureNotice}</p>}
            </div>
          </article>
        ))}
      </div>
      {error && <p className="wt-statusline" role="alert" data-testid="guide-error">{error}</p>}
      <p className="wt-guide-disclaimer">The guide uses this area and saved progress. AI text is unreviewed; only a worker can record inspection decisions.</p>
      <div className="wt-guide-prompts" aria-label="Ask the walkthrough guide">
        {GUIDE_ACTIONS.map((action) => (
          <button key={action} type="button" disabled={pending} onClick={() => void ask(action)}>
            {pending ? "Thinking…" : actionLabel(action)}
          </button>
        ))}
      </div>
      {children}
    </aside>
  );
}
