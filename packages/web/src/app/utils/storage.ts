import {
  HUMAN_TOKEN_KEY,
  LAST_ROOM_ID_KEY,
  ROOM_SESSION_KEY_PREFIX,
} from '../types';
import type { RoomSession } from '../types';

export function roomSessionKey(roomId: string): string {
  return `${ROOM_SESSION_KEY_PREFIX}${roomId}`;
}

export function saveRoomSession(roomId: string, seatToken: string, mySide: 1 | 2): void {
  if (!roomId || !seatToken) {
    return;
  }
  localStorage.setItem(roomSessionKey(roomId), JSON.stringify({ seatToken, mySide } as RoomSession));
}

export function loadRoomSession(roomId: string): RoomSession | null {
  if (!roomId) {
    return null;
  }
  const raw = localStorage.getItem(roomSessionKey(roomId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as RoomSession;
    if (!parsed?.seatToken || (parsed.mySide !== 1 && parsed.mySide !== 2)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearRoomSession(roomId: string): void {
  if (!roomId) {
    return;
  }
  localStorage.removeItem(roomSessionKey(roomId));
}

export function getOrCreateHumanToken(): string {
  const existed = localStorage.getItem(HUMAN_TOKEN_KEY);
  if (existed) {
    return existed;
  }
  const token = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(HUMAN_TOKEN_KEY, token);
  return token;
}

export function saveLastRoomId(roomId: string): void {
  if (!roomId) {
    return;
  }
  localStorage.setItem(LAST_ROOM_ID_KEY, roomId);
}

export function loadLastRoomId(): string {
  return localStorage.getItem(LAST_ROOM_ID_KEY) ?? '';
}

export function clearLastRoomId(): void {
  localStorage.removeItem(LAST_ROOM_ID_KEY);
}
