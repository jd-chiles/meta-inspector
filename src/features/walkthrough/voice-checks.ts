/**
 * In-person checks the camera cannot prove, asked by voice while filming.
 * Two short questions per room type, tied to the Form 1083 criteria text.
 * Answers are recorded on the inspection and quoted in confirm rationales.
 */
import { parseRoomId, type MoveInReadyRoomId, type MoveInReadyRoomType } from "../../domain/move-in-ready";

export const VOICE_ROOM_CHECKS: Record<MoveInReadyRoomType, readonly [string, ...string[]]> = {
  kitchen: [
    "Turn on the faucet. Is hot water running clear?",
    "Is the cooking and food storage area usable?",
  ],
  bathroom: [
    "Turn on the faucet. Is hot water running clear?",
    "Flush the toilet. Is everything working?",
  ],
  bedroom: [
    "Do the windows and door locks work?",
    "Is there a working smoke detector in or near this room?",
  ],
  "living-room": [
    "Turn on the heat or cooling. Is it working?",
    "Is there a working smoke detector in or near this room?",
  ],
  hallway: [
    "Is the exit path clear and usable?",
    "Is there a working smoke detector along this path?",
  ],
};

/** REQ-F2 visual-alarms check (Form 1083 fire safety 10c), asked in bedroom and hallway only. */
export const VISUAL_STROBE_ALARM_CHECK =
  "Is a working visual strobe alarm installed for the sleeping area?";

/** Spanish variant of the REQ-F2 visual-alarms check (REQ-R2 tour language). */
export const VISUAL_STROBE_ALARM_CHECK_ES =
  "¿Está instalada una alarma visual estroboscópica en funcionamiento para la zona de dormitorios?";

const VISUAL_STROBE_ALARM_ROOM_TYPES: readonly MoveInReadyRoomType[] = ["bedroom", "hallway"];

/**
 * Record-aware room checks: the constant table above is the base; when the
 * record flags that the participant needs visual (strobe) alarms, bedroom
 * and hallway gain the strobe question. Unknown rooms yield no questions.
 * `language` selects the English or Spanish base table (REQ-R2); the
 * default keeps every existing caller on English.
 */
export function checksForRoom(
  record: { participantVisualAlarmsRequired?: boolean | null },
  roomId: MoveInReadyRoomId,
  language: "en" | "es" = "en",
): readonly string[] {
  const parsed = parseRoomId(roomId);
  if (!parsed) return [];
  const base = language === "es" ? VOICE_ROOM_CHECKS_ES[parsed.type] : VOICE_ROOM_CHECKS[parsed.type];
  if (record.participantVisualAlarmsRequired === true && (VISUAL_STROBE_ALARM_ROOM_TYPES as readonly string[]).includes(parsed.type)) {
    return [...base, language === "es" ? VISUAL_STROBE_ALARM_CHECK_ES : VISUAL_STROBE_ALARM_CHECK];
  }
  return base;
}

/**
 * Spoken setup questions. Exported (not inline JSX) because pre-generated
 * voice clips match by exact text: the inventory contract test pins these
 * strings, so rewording one without regenerating audio silently revives
 * live-speech lag instead of breaking the build.
 */
export const SETUP_VOICE_QUESTIONS = {
  evaluatorName: "Your name goes on each decision. What is your name?",
  unitTypeTour: "What type of unit is it?",
  unitTypeCapture: "What type of unit is this? Say studio, or how many bedrooms.",
  baths: "How many bathrooms?",
} as const;

/** Spoken reprompts when a voice answer cannot be parsed. Exact-text pinned like the setup questions. */
export const TOUR_REPROMPTS = {
  unitType: "I didn't catch that. Tap your unit type below.",
  baths: "I didn't catch that. Tap the bathroom count below.",
  yesNo: "I didn't catch that. Say yes or no, or tap an answer.",
} as const;

/**
 * Spanish variants of the guided-tour room checks, setup questions, and
 * reprompts (REQ-R2). Same shape and order as the English tables: index N
 * in one language is the same question as index N in the other, so tour
 * position logic never branches on language. Pinned by the voice-inventory
 * contract test against VOICE_CLIP_TEXTS_ES.
 */
export const VOICE_ROOM_CHECKS_ES: Record<MoveInReadyRoomType, readonly [string, ...string[]]> = {
  kitchen: [
    "Abra el grifo. ¿Sale agua caliente y clara?",
    "¿El área de cocina y almacenamiento de alimentos se puede usar?",
  ],
  bathroom: [
    "Abra el grifo. ¿Sale agua caliente y clara?",
    "Descargue el inodoro. ¿Funciona todo bien?",
  ],
  bedroom: [
    "¿Funcionan las ventanas y las cerraduras de las puertas?",
    "¿Hay un detector de humo en funcionamiento en esta habitación o cerca?",
  ],
  "living-room": [
    "Encienda la calefacción o el aire acondicionado. ¿Funciona?",
    "¿Hay un detector de humo en funcionamiento en esta habitación o cerca?",
  ],
  hallway: [
    "¿La ruta de salida está despejada y se puede usar?",
    "¿Hay un detector de humo en funcionamiento a lo largo de este pasaje?",
  ],
};

export const SETUP_VOICE_QUESTIONS_ES = {
  evaluatorName: "Su nombre aparece en cada decisión. ¿Cómo se llama?",
  unitTypeTour: "¿Qué tipo de unidad es?",
  unitTypeCapture: "¿Qué tipo de unidad es esta? Diga estudio o cuántas habitaciones tiene.",
  baths: "¿Cuántos baños tiene?",
} as const;

export const TOUR_REPROMPTS_ES = {
  unitType: "No le entendí. Toque su tipo de unidad abajo.",
  baths: "No le entendí. Toque el número de baños abajo.",
  yesNo: "No le entendí. Diga sí o no, o toque una respuesta.",
} as const;
