import { parseRoomId } from "./move-in-ready";

/** Maximum duration accepted anywhere in the room-video pipeline. */
export const MAX_ROOM_VIDEO_DURATION_SECONDS = 30;
/** Element-specific capture remains capped at the existing short-clip limit. */
export const ELEMENT_VIDEO_DURATION_SECONDS = 30;

const ROOM_DURATION_SECONDS = {
  kitchen: 30,
  bathroom: 30,
  bedroom: 30,
  "living-room": 30,
  hallway: 15,
} as const;

/** Per-room recording and analysis cap, shared by browser storage and server validation. */
export function getRoomVideoDurationLimitSeconds(roomId: string): number | null {
  const parsed = parseRoomId(roomId);
  return parsed ? ROOM_DURATION_SECONDS[parsed.type] : null;
}
