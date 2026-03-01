import { Bot, Check, Copy, ScrollText, Shield, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { GameState } from '../types';
import { formatCountdown } from '../utils/misc';

type RoomViewProps = {
  t: TFunction;
  roomId: string;
  state: GameState;
  mySide: 0 | 1 | 2;
  msg: string;
  showGameStart: boolean;
  copiedRoomId: boolean;
  copiedRoomPrompt: boolean;
  dismissedBanner: boolean;
  recentLogs: GameState['decisionLogs'];
  waitingForOpponent: boolean;
  isTwoHumans: boolean;
  roomAgentPrompt: string;
  turnRemainingMs: number;
  backToHome: () => Promise<void>;
  copyRoomIdBadge: () => Promise<void>;
  copyPrompt: (prompt: string, target: 'home' | 'room') => Promise<void>;
  place: (x: number, y: number) => Promise<void>;
  setDismissedBanner: (v: boolean) => void;
  finishResultTitle: () => string;
  finishReasonLabel: (reason: GameState['finishReason']) => string;
};

export function RoomView(props: RoomViewProps) {
  const {
    t,
    roomId,
    state,
    mySide,
    msg,
    showGameStart,
    copiedRoomId,
    copiedRoomPrompt,
    dismissedBanner,
    recentLogs,
    waitingForOpponent,
    isTwoHumans,
    roomAgentPrompt,
    turnRemainingMs,
    backToHome,
    copyRoomIdBadge,
    copyPrompt,
    place,
    setDismissedBanner,
    finishResultTitle,
    finishReasonLabel,
  } = props;
  const orderedLogs = [...recentLogs].sort((a, b) => b.createdAt - a.createdAt);
  const formatLogTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false });

  return (
    <div style={{ width: '100%' }}>
      <div className="room-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }} onClick={() => void backToHome()}>
          <img src="/logo.svg" alt="Logo" className="room-logo" />
          <h2 className="title-pixel" style={{ margin: 0, fontSize: '1.4rem', display: 'flex', alignItems: 'baseline', gap: '8px' }} title={t('room.backHome')}>
            ClawGame
            <span style={{ color: 'var(--color-dark)', fontSize: '0.9rem', textShadow: 'none', WebkitTextStroke: '0' }}>x 五子棋</span>
          </h2>
        </div>
        {state.status === 'waiting' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button type="button" className={`room-id-copy-btn${copiedRoomId ? ' copied' : ''}`} onClick={() => void copyRoomIdBadge()} title={t('common.clickToCopy', '点击复制')}>
              <span className="room-id-label">ID</span>
              <span className="room-id-value">{roomId}</span>
              <span className="room-id-feedback">
                {copiedRoomId ? <><Check size={14} />{t('common.copied')}</> : <><Copy size={14} />{t('common.clickToCopy', '点击复制')}</>}
              </span>
            </button>
          </div>
        )}
      </div>

      {waitingForOpponent && (
        <div className="panel prompt-panel">
          <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bot size={18} color="#38bdf8" /> {t('room.waitingOpponentAndSendPrompt')}
          </h3>
          <textarea className="prompt-box" value={roomAgentPrompt} readOnly style={{ height: '80px' }} />
          <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="secondary" onClick={() => void copyPrompt(roomAgentPrompt, 'room')}>
              {copiedRoomPrompt ? <Check size={16} /> : <Copy size={16} />}
              {copiedRoomPrompt ? t('common.copied') : t('common.copyPrompt')}
            </button>
          </div>
        </div>
      )}

      <div className={`game-container ${isTwoHumans ? 'centered' : ''}`}>
        <div className="board-wrapper">
          {showGameStart && <div className="game-start-banner title-pixel">{t('room.gameStart')}</div>}
          <div className="board-info">
            <div className="board-info-main">
              <span className="status-badge">{state.status === 'playing' ? t('room.status.playing') : state.status === 'finished' ? t('room.status.finished') : t('room.status.waiting')}</span>
              <span>{t('room.currentTurn')}: {state.currentTurn === 1 ? t('room.blackFirst') : t('room.white')}</span>
            </div>
            {state.status === 'playing' && (
              <div className="board-info-live">
                <span>{t('room.moveCount')}: {state.moves}</span>
                <span className="board-countdown">
                  {t('room.turnCountdown')}:
                  <span>{formatCountdown(turnRemainingMs)}</span>
                </span>
              </div>
            )}
          </div>

          <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center', gap: '24px' }}>
            {state.players.length === 0 ? <span style={{ color: '#64748b' }}>{t('room.noPlayers')}</span> : state.players.map((p, i) => (
              <div key={i} className={`player-label ${p.side === 1 ? 'black' : 'white'} ${state.currentTurn === p.side ? 'active' : ''}`}>
                <Shield size={16} />
                <span>{p.side === 1 ? t('room.side.blackShort') : t('room.side.whiteShort')}: {p.name} {p.actorType !== 'human' && <Bot size={14} style={{ display: 'inline', marginLeft: 4 }} />}</span>
              </div>
            ))}
          </div>

          {state.status === 'finished' && !dismissedBanner && (
            <div className="finish-banner">
              <button className="close-banner-btn" onClick={() => setDismissedBanner(true)} aria-label="Close"><X size={16} /></button>
              {finishResultTitle()}
              {state.finishReason && <span style={{ fontSize: '0.85em', fontWeight: 'normal', display: 'block', marginTop: 4, color: '#94a3b8' }}>{t('room.reason')}: {finishReasonLabel(state.finishReason)}</span>}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div className="board-surface">
              <div className="grid-lines" aria-hidden />
              <div className="grid">
                {state.board.map((row, y) => row.map((cell, x) => (
                  <button
                    key={`${x}-${y}`}
                    className={['cell', x === 0 ? 'edge-left' : '', x === row.length - 1 ? 'edge-right' : '', y === 0 ? 'edge-top' : '', y === state.board.length - 1 ? 'edge-bottom' : '', (x === 3 || x === 11 || x === 7) && (y === 3 || y === 11 || y === 7) ? 'is-hoshi' : ''].filter(Boolean).join(' ')}
                    onClick={() => void place(x, y)}
                    disabled={cell !== 0 || state.status !== 'playing' || state.currentTurn !== mySide}
                    aria-label={`cell-${x}-${y}`}
                  >
                    {cell !== 0 && <span className={`stone ${cell === 1 ? 'black' : 'white'}`} />}
                    {(x === 3 || x === 11 || x === 7) && (y === 3 || y === 11 || y === 7) && <span className="hoshi-point" />}
                    {state.lastMove?.x === x && state.lastMove?.y === y && <span className="last-move-indicator" />}
                  </button>
                )))}
              </div>
            </div>
          </div>
          {msg && <p style={{ color: '#ef4444', textAlign: 'center', marginTop: '1rem' }}>{msg}</p>}
        </div>

        {!isTwoHumans && (
          <div className="log-panel panel">
            <div className="log-header">
              <span className="log-header-icon"><ScrollText size={20} color="#38bdf8" /></span>
              <h3>{t('room.agentDecisionLogs')}</h3>
            </div>
            <div className="log-content">
              {orderedLogs.length === 0 ? <p style={{ color: '#64748b', textAlign: 'center', marginTop: '2rem' }}>{t('room.noLogs')}</p> : orderedLogs.map((log) => (
                <div className="log-item" key={`${log.moveNo}-${log.createdAt}`}>
                  <div className="log-meta">
                    <span>#{log.moveNo} {log.side === 1 ? t('room.side.blackShort') : t('room.side.whiteShort')}({log.playerName})</span>
                    <span>{formatLogTime(log.createdAt)} · ({log.x}, {log.y}) - {log.source}</span>
                  </div>
                  <div className="log-text">{log.thought}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
