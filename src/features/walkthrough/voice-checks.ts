/**
 * In-person checks the camera cannot prove, asked by voice while filming.
 * Two short questions per room type, tied to the Form 1083 criteria text.
 * Answers are recorded on the inspection and quoted in confirm rationales.
 */
import type { MoveInReadyRoomType } from "../../domain/move-in-ready";

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
