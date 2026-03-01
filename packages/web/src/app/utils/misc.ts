import type { GameState } from '../types';

export function normalizeRoomIdInput(value: string): string {
  const input = value.trim();
  if (!input) {
    return '';
  }

  const uuidMatch = input.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (uuidMatch?.[0]) {
    return uuidMatch[0].toLowerCase();
  }

  const queryIndex = input.indexOf('?');
  const queryString = queryIndex >= 0 ? input.slice(queryIndex + 1) : input.startsWith('roomId=') ? input : '';
  if (queryString) {
    const params = new URLSearchParams(queryString);
    const roomId = params.get('roomId');
    if (roomId) {
      return roomId.trim().toLowerCase();
    }
  }

  return input.toLowerCase();
}

export function getSystemLocale(): string {
  const locale = navigator.language?.trim();
  return locale ? locale : 'en-US';
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function finishReasonLabel(
  reason: GameState['finishReason'],
  mySide: 0 | 1 | 2,
  state: GameState,
  t: (key: string) => string,
): string {
  if (reason === 'win') {
    if (mySide !== 0 && state.winner !== 0) {
      return state.winner === mySide ? t('room.finishReason.perspective.wonByFive') : t('room.finishReason.perspective.lostByFive');
    }
    return t('room.finishReason.win');
  }
  if (reason === 'draw_board_full') {
    return t('room.finishReason.boardFull');
  }
  if (reason === 'opponent_timeout') {
    if (mySide !== 0 && state.winner !== 0) {
      return state.winner === mySide
        ? t('room.finishReason.perspective.opponentTimeout')
        : t('room.finishReason.perspective.selfTimeout');
    }
    return t('room.finishReason.opponentTimeout');
  }
  return '';
}

export function finishResultTitle(state: GameState, mySide: 0 | 1 | 2, t: (key: string) => string): string {
  if (state.winner === 0) {
    return t('room.result.draw');
  }
  if (mySide !== 0) {
    return state.winner === mySide ? t('room.result.won') : t('room.result.lost');
  }
  return state.winner === 1 ? t('room.winner.black') : t('room.winner.white');
}
