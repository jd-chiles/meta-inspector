/**
 * Deterministic parsing for voice answers. No model calls: the spoken
 * transcript is matched against small keyword sets for yes/no, unit type,
 * and bath count. Anything ambiguous returns null so the UI re-asks.
 */
import type { MoveInReadyUnitType } from "../../domain/move-in-ready";

const YES_WORDS = ["yes", "yeah", "yep", "yup", "sure", "correct", "right", "affirmative", "definitely", "agree", "agreed", "confirm", "confirmed"];
const NO_WORDS = ["no", "nope", "nah", "negative", "not", "disagree", "disagreed"];

function firstMatchIndex(text: string, words: readonly string[]): number {
  let best = -1;
  for (const word of words) {
    const index = text.search(new RegExp(`\\b${word}\\b`));
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}

/** First yes/no cue wins; "not working" counts as no. */
export function parseYesNo(transcript: string): "yes" | "no" | null {
  const text = transcript.toLowerCase();
  if (/\bnot\b/.test(text)) return "no";
  const yesAt = firstMatchIndex(text, YES_WORDS);
  const noAt = firstMatchIndex(text, NO_WORDS);
  if (yesAt < 0 && noAt < 0) return null;
  if (noAt >= 0 && (yesAt < 0 || noAt < yesAt)) return "no";
  return "yes";
}

const BEDROOM_WORDS: Array<{ unit: MoveInReadyUnitType; words: readonly string[] }> = [
  { unit: "1-bedroom", words: ["one bedroom", "one bed", "1 bedroom", "1 bed", "single bedroom"] },
  { unit: "2-bedroom", words: ["two bedroom", "two bed", "2 bedroom", "2 bed", "double bedroom"] },
  { unit: "3-bedroom", words: ["three bedroom", "three bed", "3 bedroom", "3 bed", "triple bedroom"] },
  { unit: "4-bedroom", words: ["four bedroom", "four bed", "4 bedroom", "4 bed"] },
];

export function parseUnitType(transcript: string): MoveInReadyUnitType | null {
  const text = transcript.toLowerCase();
  if (/\bstudio\b/.test(text)) return "studio";
  for (const { unit, words } of BEDROOM_WORDS) {
    if (words.some((phrase) => text.includes(phrase))) return unit;
  }
  const bare = text.match(/\b(one|two|three|four|1|2|3|4)\b/);
  if (bare?.[1]) {
    const word = bare[1];
    if (word === "one" || word === "1") return "1-bedroom";
    if (word === "two" || word === "2") return "2-bedroom";
    if (word === "three" || word === "3") return "3-bedroom";
    return "4-bedroom";
  }
  return null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};

/** Bath count from "2 baths", "two bathrooms", or a bare number. */
export function parseBathCount(transcript: string): number | null {
  const text = transcript.toLowerCase();
  const withUnit = text.match(/\b(one|two|three|four|five|six|seven|eight|1|2|3|4|5|6|7|8)\s*(bath|baths|bathroom|bathrooms)\b/);
  const token = withUnit?.[1] ?? text.match(/\b([1-8])\b/)?.[1] ?? null;
  if (!token) return null;
  const numeric = Number(token);
  if (Number.isSafeInteger(numeric)) return numeric;
  return NUMBER_WORDS[token] ?? null;
}
