/**
 * Filming narration tables for the guided tour and capture overlay, keyed
 * by room type. Deterministic shot lists, never model output. Voice text
 * stays short for spoken readout. (The floating guide popup and its node
 * model were removed: the guided tour is the single AI surface.)
 */

import {
  parseRoomId,
  type MoveInReadyRoomId,
  type MoveInReadyRoomType,
} from "../../domain/move-in-ready";

export const ASSISTANT_FILMING_SCRIPTS: Record<MoveInReadyRoomType, readonly string[]> = {
  kitchen: [
    "Recording. First, run the kitchen faucet and show the water flow and drainage.",
    "Now pan across the sink, counters, and outlets.",
    "Open the entry door and test its lock.",
    "Finally, show the smoke or carbon monoxide detector and its indicator light.",
  ],
  bathroom: [
    "Recording. First, run the bathroom faucet and show the flow and drainage.",
    "Now show the toilet, sink, and surfaces.",
    "Show the ventilation fan running.",
  ],
  bedroom: [
    "Recording. First, walk the bedroom showing walls and floors.",
    "Now show the windows, locks, and heating or cooling equipment.",
    "Show the light fixtures and outlets.",
    "Finally, show the smoke or carbon monoxide detector.",
  ],
  "living-room": [
    "Recording. First, walk the living room showing walls and floors.",
    "Now show the windows, locks, and heating or cooling equipment.",
    "Show the light fixtures and outlets.",
    "Finally, show the smoke or carbon monoxide detector.",
  ],
  hallway: [
    "Recording. First, walk the full hallway showing the exit path.",
    "Now show the exit door and any secondary exit or fire escape window.",
    "Show the lighting along the path.",
    "Finally, show the smoke or carbon monoxide detector.",
  ],
};

/**
 * Spanish variants of the filming cues (REQ-R2). Same shape and order as
 * the English table: cue N in one language is the same shot as cue N in
 * the other. Pinned by the voice-inventory contract test against
 * VOICE_CLIP_TEXTS_ES.
 */
export const ASSISTANT_FILMING_SCRIPTS_ES: Record<MoveInReadyRoomType, readonly string[]> = {
  kitchen: [
    "Grabando. Primero, abra el grifo de la cocina y muestre el flujo y el desagüe.",
    "Ahora muestre el fregadero, las encimeras y los enchufes.",
    "Abra la puerta de entrada y pruebe su cerradura.",
    "Por último, muestre el detector de humo o monóxido de carbono y su luz indicadora.",
  ],
  bathroom: [
    "Grabando. Primero, abra el grifo del baño y muestre el flujo y el desagüe.",
    "Ahora muestre el inodoro, el lavabo y las superficies.",
    "Muestre el ventilador funcionando.",
  ],
  bedroom: [
    "Grabando. Primero, recorra la habitación mostrando paredes y pisos.",
    "Ahora muestre las ventanas, las cerraduras y el equipo de calefacción o aire.",
    "Muestre las lámparas y los enchufes.",
    "Por último, muestre el detector de humo o monóxido de carbono.",
  ],
  "living-room": [
    "Grabando. Primero, recorra la sala mostrando paredes y pisos.",
    "Ahora muestre las ventanas, las cerraduras y el equipo de calefacción o aire.",
    "Muestre las lámparas y los enchufes.",
    "Por último, muestre el detector de humo o monóxido de carbono.",
  ],
  hallway: [
    "Grabando. Primero, recorra todo el pasillo mostrando la ruta de salida.",
    "Ahora muestre la puerta de salida y cualquier salida secundaria o ventana de escape.",
    "Muestre la iluminación del pasaje.",
    "Por último, muestre el detector de humo o monóxido de carbono.",
  ],
};

/** Filming narration for a concrete room, resolved by room type. */
export function filmingScriptForRoom(roomId: MoveInReadyRoomId, language: "en" | "es" = "en"): readonly string[] {
  const table = language === "es" ? ASSISTANT_FILMING_SCRIPTS_ES : ASSISTANT_FILMING_SCRIPTS;
  const parsed = parseRoomId(roomId);
  if (!parsed) return table.hallway;
  return table[parsed.type];
}
