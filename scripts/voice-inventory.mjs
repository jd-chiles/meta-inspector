/**
 * Single source of truth for pre-generated voice clips: every static string
 * the app speaks through Fish Audio (tour scripts, setup questions, room
 * checks, filming cues). Dynamic scripts (film-room position, live proofs,
 * review-item excerpts, finish counts) stay live with a server-side cache.
 *
 * Playback matches by exact text: stay in sync with the sources named per
 * entry. tests/unit/walkthrough/voice-inventory.test.ts guards every entry
 * against its source; a drifted string safely falls back to live speech.
 */
import { createHash } from "node:crypto";

const TOUR_STATIC = [
  // tourScriptForNode welcome/consent/analyze + finish with zero missing,
  // plus the signoff-chain static narrations (element-details narration
  // embeds its element label, so it stays live like review-item).
  "I will guide this inspection step by step. You film each room, answer a few questions by voice, and review the A I drafts. About ten minutes. Tap Start when you are ready.",
  "Quick consent before we film. This demo inspects a staged mock unit only, with no tenants, faces, or real case data. Each clip you film is sent to Meta for A I analysis. Tap I understand, let's film, to continue.",
  "Every room is filmed. Sending your clips for A I analysis now. This takes a few minutes. Stay on this screen.",
  "Inspection complete. Every input is done, signatures included. Head to sign-off to review and export.",
  "Fire Safety has two marks: unit detectors and public-area detectors. Set each one, then save.",
  "Enter your agency name for the form.",
  "Agency leadership: printed name, signature, and date.",
  "The participant signs here: name, signature, and the walkthrough statement.",
  "Your turn: typed signature and the evaluator statement.",
];

const SETUP_QUESTIONS = [
  // GuidedTourView ask-name / ask-unit / ask-baths + capture setup voice.
  "Your name goes on each decision. What is your name?",
  "What type of unit is it?",
  "What type of unit is this? Say studio, or how many bedrooms.",
  "How many bathrooms?",
];

const ROOM_CHECKS = [
  // VOICE_ROOM_CHECKS, every room type.
  "Turn on the faucet. Is hot water running clear?",
  "Is the cooking and food storage area usable?",
  "Flush the toilet. Is everything working?",
  "Do the windows and door locks work?",
  "Is there a working smoke detector in or near this room?",
  "Turn on the heat or cooling. Is it working?",
  "Is the exit path clear and usable?",
  "Is there a working smoke detector along this path?",
];

const REPROMPTS = [
  // TOUR_REPROMPTS: spoken when a voice answer cannot be parsed.
  "I didn't catch that. Tap your unit type below.",
  "I didn't catch that. Tap the bathroom count below.",
  "I didn't catch that. Say yes or no, or tap an answer.",
];

const REVIEW_AND_TEST = [
  // REVIEW_VOICE_QUESTION + LANDLORD_VOICE_QUESTION (guided-tour.ts) +
  // DETECTOR_TEST_PROMPT (detector-test.ts): static prompts on cards.
  "Say yes to confirm this draft, or no to edit it.",
  "Did you discuss the findings with the landlord?",
  "Press the detector's test button now",
];

const FILMING_CUES = [
  // ASSISTANT_FILMING_SCRIPTS, raw spoken form per room type.
  "Recording. First, run the kitchen faucet and show the water flow and drainage.",
  "Now pan across the sink, counters, and outlets.",
  "Open the entry door and test its lock.",
  "Finally, show the smoke or carbon monoxide detector and its indicator light.",
  "Recording. First, run the bathroom faucet and show the flow and drainage.",
  "Now show the toilet, sink, and surfaces.",
  "Show the ventilation fan running.",
  "Finally, show the smoke or carbon monoxide detector.",
  "Recording. First, walk the bedroom showing walls and floors.",
  "Now show the windows, locks, and heating or cooling equipment.",
  "Show the light fixtures and outlets.",
  "Recording. First, walk the living room showing walls and floors.",
  "Recording. First, walk the full hallway showing the exit path.",
  "Now show the exit door and any secondary exit or fire escape window.",
  "Show the lighting along the path.",
];

/** Every static spoken string, deduplicated, in stable generation order. */
export const VOICE_CLIP_TEXTS = [...new Set([...TOUR_STATIC, ...SETUP_QUESTIONS, ...ROOM_CHECKS, ...FILMING_CUES, ...REPROMPTS, ...REVIEW_AND_TEST])];

/**
 * Spanish-tour static strings (REQ-R2), mirroring the English groups above.
 * Generated with the Spanish owner voice (FISH_VOICE_ID_ES) into
 * public/voice/es/ via `node scripts/generate-voice.mjs --lang es`.
 */
const TOUR_STATIC_ES = [
  // TOUR_SCRIPT_ES welcome/consent/analyze + finishComplete + signoff chain.
  "Le guiaré en esta inspección paso a paso. Usted filma cada habitación, responde algunas preguntas por voz y revisa los borradores de la IA. Unos diez minutos. Toque Comenzar cuando esté listo.",
  "Un consentimiento rápido antes de filmar. Esta demostración inspecciona solo una unidad simulada de prueba, sin inquilinos, rostros ni datos reales. Cada clip que filme se envía a Meta para el análisis de IA. Toque Entiendo, vamos a filmar para continuar.",
  "Ya filmó todas las habitaciones. Enviando sus clips para el análisis de IA. Esto toma unos minutos. Permanezca en esta pantalla.",
  "Inspección completa. Todas las entradas están listas, firmas incluidas. Vaya a la firma para revisar y exportar.",
  "Seguridad contra incendios tiene dos marcas: detectores de la unidad y de áreas comunes. Marque cada uno, luego guarde.",
  "Escriba el nombre de su agencia para el formulario.",
  "Dirección de la agencia: nombre en letra de imprenta, firma y fecha.",
  "El participante firma aquí: nombre, firma y la declaración del recorrido.",
  "Su turno: firma escrita y la declaración del evaluador.",
];

const SETUP_QUESTIONS_ES = [
  // SETUP_VOICE_QUESTIONS_ES.
  "Su nombre aparece en cada decisión. ¿Cómo se llama?",
  "¿Qué tipo de unidad es?",
  "¿Qué tipo de unidad es esta? Diga estudio o cuántas habitaciones tiene.",
  "¿Cuántos baños tiene?",
];

const ROOM_CHECKS_ES = [
  // VOICE_ROOM_CHECKS_ES, every room type.
  "Abra el grifo. ¿Sale agua caliente y clara?",
  "¿El área de cocina y almacenamiento de alimentos se puede usar?",
  "Descargue el inodoro. ¿Funciona todo bien?",
  "¿Funcionan las ventanas y las cerraduras de las puertas?",
  "¿Hay un detector de humo en funcionamiento en esta habitación o cerca?",
  "Encienda la calefacción o el aire acondicionado. ¿Funciona?",
  "¿La ruta de salida está despejada y se puede usar?",
  "¿Hay un detector de humo en funcionamiento a lo largo de este pasaje?",
];

const REPROMPTS_ES = [
  // TOUR_REPROMPTS_ES.
  "No le entendí. Toque su tipo de unidad abajo.",
  "No le entendí. Toque el número de baños abajo.",
  "No le entendí. Diga sí o no, o toque una respuesta.",
];

const REVIEW_AND_TEST_ES = [
  // REVIEW_VOICE_QUESTION_ES + LANDLORD_VOICE_QUESTION_ES + DETECTOR_TEST_PROMPT_ES.
  "Diga sí para confirmar este borrador, o no para editarlo.",
  "¿Habló de los resultados con el propietario?",
  "Presione ahora el botón de prueba del detector",
];

const FILMING_CUES_ES = [
  // ASSISTANT_FILMING_SCRIPTS_ES, raw spoken form per room type.
  "Grabando. Primero, abra el grifo de la cocina y muestre el flujo y el desagüe.",
  "Ahora muestre el fregadero, las encimeras y los enchufes.",
  "Abra la puerta de entrada y pruebe su cerradura.",
  "Por último, muestre el detector de humo o monóxido de carbono y su luz indicadora.",
  "Grabando. Primero, abra el grifo del baño y muestre el flujo y el desagüe.",
  "Ahora muestre el inodoro, el lavabo y las superficies.",
  "Muestre el ventilador funcionando.",
  "Grabando. Primero, recorra la habitación mostrando paredes y pisos.",
  "Ahora muestre las ventanas, las cerraduras y el equipo de calefacción o aire.",
  "Muestre las lámparas y los enchufes.",
  "Grabando. Primero, recorra la sala mostrando paredes y pisos.",
  "Grabando. Primero, recorra todo el pasillo mostrando la ruta de salida.",
  "Ahora muestre la puerta de salida y cualquier salida secundaria o ventana de escape.",
  "Muestre la iluminación del pasaje.",
  "Por último, muestre el detector de humo o monóxido de carbono.",
];

/** Every static Spanish spoken string, deduplicated, in stable generation order. */
export const VOICE_CLIP_TEXTS_ES = [...new Set([...TOUR_STATIC_ES, ...SETUP_QUESTIONS_ES, ...ROOM_CHECKS_ES, ...FILMING_CUES_ES, ...REPROMPTS_ES, ...REVIEW_AND_TEST_ES])];

/** Normalize exactly like the client lookup: trim only, never reword. */
export function normalizeVoiceText(text) {
  return text.trim();
}

/**
 * Content id for one clip: first 16 hex chars of sha256(trimmed text).
 * The client recomputes this with SubtleCrypto; keep the algorithm in sync.
 */
export function voiceClipId(text) {
  return createHash("sha256").update(normalizeVoiceText(text), "utf8").digest("hex").slice(0, 16);
}

/** Static asset path served from public/voice. */
export function voiceClipFile(text) {
  return `${voiceClipId(text)}.mp3`;
}
