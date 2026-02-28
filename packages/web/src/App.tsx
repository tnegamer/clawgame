import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Users, Shield, Bot, Play, ScrollText, Sun, Moon, Globe } from 'lucide-react';

type Cell = 0 | 1 | 2;
type Status = 'waiting' | 'playing' | 'finished';

type GameState = {
  roomId: string;
  status: Status;
  board: Cell[][];
  currentTurn: 1 | 2;
  winner: 0 | 1 | 2;
  finishReason: 'win' | 'draw_board_full' | 'opponent_timeout' | null;
  moves: number;
  players: { side: 1 | 2; actorType: 'human' | 'agent'; actorId: string; name: string; locale?: string }[];
  lastMove: { x: number; y: number; side: 1 | 2 } | null;
  decisionLogs: {
    moveNo: number;
    side: 1 | 2;
    playerName: string;
    x: number;
    y: number;
    source: 'llm' | 'agent' | 'heuristic';
    thought: string;
    createdAt: number;
  }[];
};

type LiveStats = {
  activePlayers: number;
  activeRooms: number;
  waitingRooms: number;
};

const emptyBoard = () => Array.from({ length: 15 }, () => Array.from({ length: 15 }, () => 0 as Cell));

function normalizeRoomIdInput(value: string): string {
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

function getSystemLocale(): string {
  const locale = navigator.language?.trim();
  return locale ? locale : 'en-US';
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const mergedHeaders = new Headers(init?.headers);
  if (!mergedHeaders.has('content-type')) {
    mergedHeaders.set('content-type', 'application/json');
  }

  const res = await fetch(url, {
    ...init,
    headers: mergedHeaders,
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json() as Promise<T>;
}

export default function App() {
  const { t, i18n } = useTranslation();

  const [name, setName] = useState(() => t('defaults.humanPlayer'));
  const [joinName, setJoinName] = useState(() => t('defaults.humanGuest'));
  const [roomInput, setRoomInput] = useState('');
  const [roomId, setRoomId] = useState('');
  const [seatToken, setSeatToken] = useState('');
  const [mySide, setMySide] = useState<0 | 1 | 2>(0);
  const [state, setState] = useState<GameState>({
    roomId: '',
    status: 'waiting',
    board: emptyBoard(),
    currentTurn: 1,
    winner: 0,
    finishReason: null,
    moves: 0,
    players: [],
    lastMove: null,
    decisionLogs: [],
  });
  const [msg, setMsg] = useState('');
  const [copiedRoomPrompt, setCopiedRoomPrompt] = useState(false);
  const [copiedHomePrompt, setCopiedHomePrompt] = useState(false);
  const [liveStats, setLiveStats] = useState<LiveStats>({ activePlayers: 0, activeRooms: 0, waitingRooms: 0 });
  const [homeTab, setHomeTab] = useState<'agent' | 'human'>('agent');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  });
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language.startsWith('zh') ? 'en' : 'zh');
  };

  function syncRoomToUrl(nextRoomId: string) {
    const url = new URL(window.location.href);
    if (nextRoomId) {
      url.searchParams.set('roomId', nextRoomId);
    } else {
      url.searchParams.delete('roomId');
    }
    window.history.replaceState({}, '', url.toString());
  }

  useEffect(() => {
    const presetRoomId = new URLSearchParams(window.location.search).get('roomId');
    if (presetRoomId) {
      setRoomId(presetRoomId);
      setRoomInput(presetRoomId);
    }
  }, []);

  useEffect(() => {
    const fetchLiveStats = async () => {
      try {
        const next = await jsonFetch<LiveStats>('/api/stats/live');
        setLiveStats(next);
      } catch {
        // ignore in home stats poll
      }
    };

    fetchLiveStats();
    const timer = setInterval(fetchLiveStats, 5000);
    return () => clearInterval(timer);
  }, []);

  const websocketParseFailed = t('messages.websocketParseFailed');
  useEffect(() => {
    if (!roomId) {
      return;
    }

    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?roomId=${roomId}`);
    ws.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data) as { type: string; state: GameState };
        if (payload.type === 'state') {
          setState(payload.state);
        }
      } catch {
        setMsg(websocketParseFailed);
      }
    };

    const timer = setInterval(async () => {
      try {
        const next = await jsonFetch<GameState>(`/api/rooms/${roomId}/state`);
        setState(next);
      } catch {
        // ignore in poll
      }
    }, 1000);

    return () => {
      ws.close();
      clearInterval(timer);
    };
  }, [roomId, websocketParseFailed]);

  useEffect(() => {
    (window as any).render_game_to_text = () =>
      JSON.stringify({
        coordinate: 'origin top-left; x right+, y down+',
        roomId,
        state,
        mySide,
      });
    (window as any).advanceTime = (_ms: number) => {
      return;
    };
  }, [roomId, state, mySide]);

  useEffect(() => {
    // Intentionally removed auto scroll to allow users to read logs
  }, [state.decisionLogs]);

  async function createRoom() {
    setMsg(t('messages.creating'));
    try {
      const payload = await jsonFetch<{ roomId: string; seatToken: string; side: 1 | 2; state: GameState }>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ actorType: 'human', name, locale: getSystemLocale() }),
      });
      setRoomId(payload.roomId);
      syncRoomToUrl(payload.roomId);
      setSeatToken(payload.seatToken);
      setMySide(payload.side);
      setState(payload.state);
      setMsg('');
    } catch (e) {
      setMsg(`${t('messages.createFailed')}: ${(e as Error).message}`);
    }
  }

  async function joinRoom() {
    const normalizedRoomId = normalizeRoomIdInput(roomInput);
    if (!normalizedRoomId) return;

    setMsg(t('messages.joining'));
    try {
      const payload = await jsonFetch<{ seatToken: string; side: 1 | 2; state: GameState }>(`/api/rooms/${normalizedRoomId}/join`, {
        method: 'POST',
        body: JSON.stringify({ actorType: 'human', name: joinName, locale: getSystemLocale() }),
      });
      setRoomInput(normalizedRoomId);
      setRoomId(normalizedRoomId);
      syncRoomToUrl(normalizedRoomId);
      setSeatToken(payload.seatToken);
      setMySide(payload.side);
      setState(payload.state);
      setMsg('');
    } catch (e) {
      setMsg(`${t('messages.joinFailed')}: ${(e as Error).message}`);
    }
  }

  async function joinMatchmaking() {
    setMsg(t('messages.matchmakingJoining'));
    try {
      const joined = await jsonFetch<{
        matched: boolean;
        ticketId: string;
        roomId?: string;
        seatToken?: string;
        side?: 1 | 2;
        state?: GameState;
      }>('/api/matchmaking/join', {
        method: 'POST',
        body: JSON.stringify({ actorType: 'human', name: joinName, locale: getSystemLocale() }),
      });

      const applyMatch = (payload: { roomId: string; seatToken: string; side: 1 | 2; state: GameState }) => {
        setRoomInput(payload.roomId);
        setRoomId(payload.roomId);
        syncRoomToUrl(payload.roomId);
        setSeatToken(payload.seatToken);
        setMySide(payload.side);
        setState(payload.state);
        setMsg('');
      };

      if (joined.matched && joined.roomId && joined.seatToken && joined.side && joined.state) {
        applyMatch({ roomId: joined.roomId, seatToken: joined.seatToken, side: joined.side, state: joined.state });
        return;
      }

      if (!joined.ticketId) {
        throw new Error('missing ticket id');
      }

      setMsg(t('messages.matchmakingWaiting'));
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const polled = await jsonFetch<{
          matched: boolean;
          ticketId: string;
          roomId?: string;
          seatToken?: string;
          side?: 1 | 2;
          state?: GameState;
        }>(`/api/matchmaking/${joined.ticketId}`);
        if (polled.matched && polled.roomId && polled.seatToken && polled.side && polled.state) {
          applyMatch({ roomId: polled.roomId, seatToken: polled.seatToken, side: polled.side, state: polled.state });
          return;
        }
      }

      throw new Error(t('messages.matchmakingTimeout'));
    } catch (e) {
      setMsg(`${t('messages.joinFailed')}: ${(e as Error).message}`);
    }
  }

  async function place(x: number, y: number) {
    if (!roomId || !seatToken) return;

    try {
      const next = await jsonFetch<GameState>(`/api/rooms/${roomId}/move`, {
        method: 'POST',
        headers: { authorization: `Bearer ${seatToken}` },
        body: JSON.stringify({ x, y }),
      });
      setState(next);
      setMsg('');
    } catch (e) {
      setMsg(`${t('messages.placeFailed')}: ${(e as Error).message}`);
    }
  }

  function finishReasonLabel(reason: GameState['finishReason']): string {
    if (reason === 'win') {
      return t('room.finishReason.win');
    }
    if (reason === 'draw_board_full') {
      return t('room.finishReason.boardFull');
    }
    if (reason === 'opponent_timeout') {
      return t('room.finishReason.opponentTimeout');
    }
    return '';
  }

  const recentLogs = [...state.decisionLogs].slice(-100);
  const homeAgentPrompt = t('prompts.home');
  const skillUrl = `${window.location.protocol}//${window.location.host}/skill.md`;
  const roomAgentPrompt = roomId
    ? t('prompts.room', { skillUrl, roomId })
    : '';

  async function copyPrompt(prompt: string, target: 'home' | 'room') {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    if (target === 'home') {
      setCopiedHomePrompt(true);
      setTimeout(() => setCopiedHomePrompt(false), 1500);
      return;
    }
    setCopiedRoomPrompt(true);
    setTimeout(() => setCopiedRoomPrompt(false), 1500);
  }

  const waitingForOpponent = state.players.length < 2 && state.status === 'waiting';

  function renderHome() {
    return (
      <div className="home-container">
        <div className="home-card panel">
          <h1 className="title">ClawGame</h1>
          <p style={{ textAlign: 'center', color: '#94a3b8', marginBottom: '2rem' }}>
            {t('app.tagline')}
          </p>

          <div className="home-stats">
            <span className="home-stats-label">{t('home.currentPlayers')}</span>
            <span className="home-stats-value">{liveStats.activePlayers}</span>
            <span className="home-stats-meta">
              {t('home.activeRoomsAndWaiting', { activeRooms: liveStats.activeRooms, waitingRooms: liveStats.waitingRooms })}
            </span>
          </div>

          <div className="home-tabs">
            <button
              className={`home-tab ${homeTab === 'agent' ? 'active' : ''}`}
              onClick={() => setHomeTab('agent')}
            >
              <Bot size={20} />
              {t('home.tabAgent')}
            </button>
            <button
              className={`home-tab ${homeTab === 'human' ? 'active' : ''}`}
              onClick={() => setHomeTab('human')}
            >
              <Users size={20} />
              {t('home.tabHuman')}
            </button>
          </div>

          <div className="home-tab-content">
            {homeTab === 'agent' && (
              <div className="panel prompt-panel home-prompt-panel">
                <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Bot size={18} color="#38bdf8" /> {t('home.copyPromptForAgent')}
                </h3>
                <textarea className="prompt-box" value={homeAgentPrompt} readOnly />
                <p className="home-prompt-tip">
                  {t('home.homePromptTip')}
                </p>
                <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="secondary" onClick={() => copyPrompt(homeAgentPrompt, 'home')}>
                    {copiedHomePrompt ? <Check size={16} /> : <Copy size={16} />}
                    {copiedHomePrompt ? t('common.copied') : t('common.copyPrompt')}
                  </button>
                </div>
              </div>
            )}

            {homeTab === 'human' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                <div className="row" style={{ width: '100%' }}>
                  <input
                    style={{ flex: 1 }}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('home.myNamePlaceholder')}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="secondary" onClick={joinMatchmaking} style={{ flex: 1 }}>
                      <Users size={18} /> {t('home.joinMatchmaking')}
                    </button>
                    <button onClick={createRoom} style={{ flex: 1 }}>
                      <Play size={18} /> {t('home.createRoom')}
                    </button>
                  </div>
                </div>

                <div className="divider">{t('home.orJoinRoom')}</div>

                <div className="row" style={{ width: '100%' }}>
                  <input
                    style={{ flex: 1 }}
                    value={roomInput}
                    onChange={(e) => setRoomInput(e.target.value)}
                    placeholder={t('home.roomIdInputPlaceholder')}
                  />
                </div>
                <div className="row" style={{ width: '100%' }}>
                  <input
                    style={{ flex: 1 }}
                    value={joinName}
                    onChange={(e) => setJoinName(e.target.value)}
                    placeholder={t('home.joinNamePlaceholder')}
                  />
                  <button className="secondary" onClick={joinRoom} disabled={!roomInput}>
                    <Users size={18} /> {t('home.joinRoom')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {msg && <p style={{ color: '#ef4444', textAlign: 'center', marginTop: '1rem' }}>{msg}</p>}
        </div>
      </div>
    );
  }

  function renderRoom() {
    return (
      <div style={{ width: '100%' }}>
        <div className="room-header">
          <h2 style={{ margin: 0 }}>
            <span style={{ color: '#38bdf8' }}>Claw</span>{t('room.roomArenaSuffix')}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 'bold' }}>ID:</span>
            <input
              readOnly
              value={roomId}
              onDoubleClick={(e) => {
                const target = e.target as HTMLInputElement;
                target.select();
                navigator.clipboard.writeText(roomId);
              }}
              style={{
                background: 'var(--color-surface)',
                border: '3px solid var(--color-dark)',
                color: 'var(--color-dark)',
                padding: '4px 8px',
                width: '320px',
                fontSize: '1rem',
                cursor: 'pointer'
              }}
              title={t('common.doubleClickToCopy', '双击复制')}
            />
          </div>
        </div>

        {waitingForOpponent && (
          <div className="panel prompt-panel">
            <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Bot size={18} color="#38bdf8" /> {t('room.waitingOpponentAndSendPrompt')}
            </h3>
            <textarea className="prompt-box" value={roomAgentPrompt} readOnly style={{ height: '80px' }} />
            <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="secondary" onClick={() => copyPrompt(roomAgentPrompt, 'room')}>
                {copiedRoomPrompt ? <Check size={16} /> : <Copy size={16} />}
                {copiedRoomPrompt ? t('common.copied') : t('common.copyPrompt')}
              </button>
            </div>
          </div>
        )}

        <div className="game-container">
          <div className="board-wrapper">
            <div className="board-info">
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span className="status-badge">
                  {state.status === 'playing' ? t('room.status.playing') : state.status === 'finished' ? t('room.status.finished') : t('room.status.waiting')}
                </span>
                <span>
                  {t('room.currentTurn')}: {state.currentTurn === 1 ? t('room.blackFirst') : t('room.white')}
                </span>
              </div>
              <div>{t('room.moveCount')}: {state.moves}</div>
            </div>

            <div style={{ marginBottom: '16px', color: '#e2e8f0', display: 'flex', justifyContent: 'center', gap: '24px' }}>
              {state.players.length === 0 ? (
                <span style={{ color: '#64748b' }}>{t('room.noPlayers')}</span>
              ) : (
                state.players.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Shield size={16} color={p.side === 1 ? '#94a3b8' : '#f8fafc'} />
                    <span style={{ fontWeight: state.currentTurn === p.side ? 'bold' : 'normal', color: state.currentTurn === p.side ? '#38bdf8' : 'inherit' }}>
                      {p.side === 1 ? t('room.side.blackShort') : t('room.side.whiteShort')}: {p.name} {p.actorType === 'agent' && <Bot size={14} style={{ display: 'inline', marginLeft: 4 }} />}
                    </span>
                  </div>
                ))
              )}
            </div>

            {state.status === 'finished' && (
              <div style={{
                margin: '16px 0', padding: '16px',
                background: '#fef2f2',
                border: '4px solid #f43f5e',
                borderRadius: '12px',
                boxShadow: '4px 4px 0 #fda4af',
                textAlign: 'center',
                color: '#e11d48', fontWeight: 'bold',
              }}>
                {state.winner === 0 ? t('room.draw') : state.winner === 1 ? t('room.winner.black') : t('room.winner.white')}
                {state.finishReason && <span style={{ fontSize: '0.85em', fontWeight: 'normal', display: 'block', marginTop: 4, color: '#94a3b8' }}>{t('room.reason')}: {finishReasonLabel(state.finishReason)}</span>}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div className="grid">
                {state.board.map((row, y) =>
                  row.map((cell, x) => (
                    <button
                      key={`${x}-${y}`}
                      className="cell"
                      onClick={() => place(x, y)}
                      disabled={cell !== 0 || state.status !== 'playing' || state.currentTurn !== mySide}
                      aria-label={`cell-${x}-${y}`}
                    >
                      {cell !== 0 && (
                        <span className={`stone ${cell === 1 ? 'black' : 'white'}`} />
                      )}
                      {state.lastMove?.x === x && state.lastMove?.y === y && (
                        <span className="last-move-indicator" />
                      )}
                    </button>
                  )),
                )}
              </div>
            </div>

            {msg && <p style={{ color: '#ef4444', textAlign: 'center', marginTop: '1rem' }}>{msg}</p>}
          </div>

          <div className="log-panel panel">
            <div className="log-header">
              <ScrollText size={20} color="#38bdf8" />
              <h3>{t('room.agentDecisionLogs')}</h3>
            </div>
            <div className="log-content">
              {recentLogs.length === 0 ? (
                <p style={{ color: '#64748b', textAlign: 'center', marginTop: '2rem' }}>{t('room.noLogs')}</p>
              ) : (
                recentLogs.map((log) => (
                  <div className="log-item" key={`${log.moveNo}-${log.createdAt}`}>
                    <div className="log-meta">
                      <span>#{log.moveNo} {log.side === 1 ? t('room.side.blackShort') : t('room.side.whiteShort')}({log.playerName})</span>
                      <span>({log.x}, {log.y}) - {log.source}</span>
                    </div>
                    <div className="log-text">{log.thought}</div>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="top-actions">
        <button className="icon-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <button className="icon-btn" onClick={toggleLanguage} title={i18n.language.startsWith('zh') ? 'Switch to English' : '切换到中文'}>
          <Globe size={20} />
          <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{i18n.language.startsWith('zh') ? 'EN' : '中'}</span>
        </button>
      </div>
      {!roomId ? renderHome() : renderRoom()}
    </>
  );
}
