import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Users, Shield, Bot, Play, ScrollText, Sun, Moon, Globe, X, Github } from 'lucide-react';
import confetti from 'canvas-confetti';

type Cell = 0 | 1 | 2;
type Status = 'waiting' | 'playing' | 'finished';

type GameState = {
  roomId: string;
  status: Status;
  board: Cell[][];
  currentTurn: 1 | 2;
  turnDeadlineAt: number | null;
  turnTimeoutMs: number;
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
    thoughtOriginal?: string;
    createdAt: number;
  }[];
};

type LiveStats = {
  activePlayers: number;
  activeRooms: number;
  waitingRooms: number;
};

const emptyBoard = () => Array.from({ length: 15 }, () => Array.from({ length: 15 }, () => 0 as Cell));
const ROOM_SESSION_KEY_PREFIX = 'clawgame:room-session:';
const HUMAN_TOKEN_KEY = 'clawgame:human-token';
const LAST_ROOM_ID_KEY = 'clawgame:last-room-id';

type RoomSession = {
  seatToken: string;
  mySide: 1 | 2;
};

const initialState: GameState = {
  roomId: '',
  status: 'waiting',
  board: emptyBoard(),
  currentTurn: 1,
  turnDeadlineAt: null,
  turnTimeoutMs: 0,
  winner: 0,
  finishReason: null,
  moves: 0,
  players: [],
  lastMove: null,
  decisionLogs: [],
};

function roomSessionKey(roomId: string): string {
  return `${ROOM_SESSION_KEY_PREFIX}${roomId}`;
}

function saveRoomSession(roomId: string, seatToken: string, mySide: 1 | 2): void {
  if (!roomId || !seatToken) return;
  localStorage.setItem(roomSessionKey(roomId), JSON.stringify({ seatToken, mySide } as RoomSession));
}

function loadRoomSession(roomId: string): RoomSession | null {
  if (!roomId) return null;
  const raw = localStorage.getItem(roomSessionKey(roomId));
  if (!raw) return null;
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

function clearRoomSession(roomId: string): void {
  if (!roomId) return;
  localStorage.removeItem(roomSessionKey(roomId));
}

function getOrCreateHumanToken(): string {
  const existed = localStorage.getItem(HUMAN_TOKEN_KEY);
  if (existed) return existed;
  const token =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(HUMAN_TOKEN_KEY, token);
  return token;
}

function saveLastRoomId(roomId: string): void {
  if (!roomId) return;
  localStorage.setItem(LAST_ROOM_ID_KEY, roomId);
}

function loadLastRoomId(): string {
  return localStorage.getItem(LAST_ROOM_ID_KEY) ?? '';
}

function clearLastRoomId(): void {
  localStorage.removeItem(LAST_ROOM_ID_KEY);
}

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

function authHeaders(token?: string): HeadersInit | undefined {
  if (!token) {
    return undefined;
  }
  return { authorization: `Bearer ${token}` };
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

const apiBaseUrl = trimTrailingSlash(import.meta.env.VITE_API_BASE_URL?.trim() || '');

function apiUrl(path: string): string {
  if (!apiBaseUrl) {
    return path;
  }
  return `${apiBaseUrl}${path}`;
}

function normalizeWsBase(raw: string): string {
  const cleaned = trimTrailingSlash(raw);
  if (cleaned.startsWith('https://')) {
    return `wss://${cleaned.slice('https://'.length)}`;
  }
  if (cleaned.startsWith('http://')) {
    return `ws://${cleaned.slice('http://'.length)}`;
  }
  return cleaned;
}

const wsBaseUrlEnv = trimTrailingSlash(import.meta.env.VITE_WS_BASE_URL?.trim() || '');
const wsBaseUrl = wsBaseUrlEnv ? normalizeWsBase(wsBaseUrlEnv) : '';

function wsUrl(pathAndQuery: string): string {
  if (wsBaseUrl) {
    return `${wsBaseUrl}${pathAndQuery}`;
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${pathAndQuery}`;
}

export default function App() {
  const { t, i18n } = useTranslation();
  const humanToken = getOrCreateHumanToken();

  const [name, setName] = useState(() => t('defaults.humanPlayer'));
  const [joinName, setJoinName] = useState(() => t('defaults.humanGuest'));
  const [roomInput, setRoomInput] = useState('');
  const [roomId, setRoomId] = useState('');
  const [seatToken, setSeatToken] = useState('');
  const [mySide, setMySide] = useState<0 | 1 | 2>(0);
  const [state, setState] = useState<GameState>(initialState);
  const [msg, setMsg] = useState('');
  const [copiedRoomPrompt, setCopiedRoomPrompt] = useState(false);
  const [copiedHomePrompt, setCopiedHomePrompt] = useState(false);
  const [liveStats, setLiveStats] = useState<LiveStats>({ activePlayers: 0, activeRooms: 0, waitingRooms: 0 });
  const [homeTab, setHomeTab] = useState<'agent' | 'human'>('agent');
  const [nowTs, setNowTs] = useState(Date.now());
  const [joinPromptRoomId, setJoinPromptRoomId] = useState<string | null>(null);
  const [joinPromptName, setJoinPromptName] = useState('');
  const [dismissedBanner, setDismissedBanner] = useState(false);
  const [showGameStart, setShowGameStart] = useState(false);

  useEffect(() => {
    if (state.status !== 'finished') {
      setDismissedBanner(false);
    }
  }, [state.status]);

  useEffect(() => {
    if (state.status === 'playing' && state.moves === 0) {
      setShowGameStart(true);
      const timer = setTimeout(() => setShowGameStart(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [state.status, state.moves, state.roomId]);
  const roomAlertedRef = useRef(false);
  const joinPromptedRoomRef = useRef<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  });

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

  async function tryRestoreRoomFromSession(nextRoomId: string): Promise<boolean> {
    const savedSession = loadRoomSession(nextRoomId);
    if (!savedSession) {
      return false;
    }

    try {
      const restoredState = await jsonFetch<GameState>(apiUrl(`/api/rooms/${nextRoomId}/state`), {
        headers: authHeaders(savedSession.seatToken),
      });
      setRoomId(nextRoomId);
      setRoomInput(nextRoomId);
      setSeatToken(savedSession.seatToken);
      setMySide(savedSession.mySide);
      setState(restoredState);
      syncRoomToUrl(nextRoomId);
      saveLastRoomId(nextRoomId);
      setMsg(t('messages.rejoinedGame'));
      return true;
    } catch {
      clearRoomSession(nextRoomId);
      return false;
    }
  }

  useEffect(() => {
    const presetRoomId = new URLSearchParams(window.location.search).get('roomId') ?? '';
    const initialRoomId = presetRoomId || loadLastRoomId();
    if (!initialRoomId) return;

    setRoomId(initialRoomId);
    setRoomInput(initialRoomId);
    void tryRestoreRoomFromSession(initialRoomId);
  }, [t]);

  useEffect(() => {
    if (!roomId || !seatToken || (mySide !== 1 && mySide !== 2)) {
      return;
    }
    saveRoomSession(roomId, seatToken, mySide);
    saveLastRoomId(roomId);
  }, [roomId, seatToken, mySide]);

  useEffect(() => {
    if (!roomId || state.status !== 'finished') {
      return;
    }
    clearRoomSession(roomId);
    clearLastRoomId();
  }, [roomId, state.status]);

  useEffect(() => {
    const fetchLiveStats = async () => {
      try {
        const next = await jsonFetch<LiveStats>(apiUrl('/api/stats/live'));
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

    const ws = new WebSocket(wsUrl(`/ws?roomId=${roomId}`));
    ws.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data) as { type: string; state?: GameState };
        if (payload.type === 'state') {
          if (payload.state) {
            setState(payload.state);
          }
          return;
        }
        if (payload.type === 'room_closed') {
          clearRoomSession(roomId);
          clearLastRoomId();
          alertAndBackHome(t('messages.roomClosedByOwner'));
        }
      } catch {
        setMsg(websocketParseFailed);
      }
    };

    const timer = setInterval(async () => {
      try {
        const next = await jsonFetch<GameState>(apiUrl(`/api/rooms/${roomId}/state`), {
          headers: authHeaders(seatToken),
        });
        setState(next);
      } catch {
        clearRoomSession(roomId);
        clearLastRoomId();
        alertAndBackHome(t('messages.noActiveBattle'));
      }
    }, 1000);

    return () => {
      ws.close();
      clearInterval(timer);
    };
  }, [roomId, seatToken, websocketParseFailed, t]);

  useEffect(() => {
    if (!roomId || mySide !== 0) {
      return;
    }
    if (state.status === 'waiting' && state.players.length === 1) {
      void promptJoinWaitingRoom(roomId);
      return;
    }
    if (state.status !== 'waiting') {
      joinPromptedRoomRef.current = null;
    }
  }, [roomId, mySide, state.status, state.players.length, joinName, humanToken, t]);

  useEffect(() => {
    if (state.status !== 'playing') {
      return;
    }
    const timer = setInterval(() => setNowTs(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.status, state.currentTurn, state.turnDeadlineAt]);

  useEffect(() => {
    if (state.status !== 'finished' || mySide === 0) return;

    if (state.winner === mySide) {
      const duration = 2500;
      const end = Date.now() + duration;
      const frame = () => {
        confetti({
          particleCount: 6,
          angle: 60,
          spread: 80,
          origin: { x: 0, y: 0.6 },
          colors: ['#38bdf8', '#818cf8', '#a78bfa', '#f472b6', '#fb923c', '#fbbf24']
        });
        confetti({
          particleCount: 6,
          angle: 120,
          spread: 80,
          origin: { x: 1, y: 0.6 },
          colors: ['#38bdf8', '#818cf8', '#a78bfa', '#f472b6', '#fb923c', '#fbbf24']
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };
      frame();
    } else if (state.winner !== 0) {
      confetti({
        particleCount: 100,
        spread: 120,
        origin: { y: -0.1 },
        colors: ['#cbd5e1', '#94a3b8', '#64748b', '#475569'],
        gravity: 0.5,
        ticks: 300,
        startVelocity: 20
      });
    } else {
      confetti({
        particleCount: 100,
        spread: 100,
        origin: { y: 0.5 },
        colors: ['#fcd34d', '#fbbf24', '#f59e0b']
      });
    }
  }, [state.status, state.winner, mySide]);

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
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!roomId || state.status !== 'playing' || mySide === 0) {
        return;
      }
      if (seatToken) {
        void fetch(apiUrl(`/api/rooms/${roomId}/leave`), {
          method: 'POST',
          headers: { authorization: `Bearer ${seatToken}` },
          keepalive: true,
        });
      }
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [roomId, state.status, mySide, seatToken]);

  async function leaveRoomIfNeeded() {
    if (!roomId || !seatToken) {
      return;
    }
    try {
      await fetch(apiUrl(`/api/rooms/${roomId}/leave`), {
        method: 'POST',
        headers: { authorization: `Bearer ${seatToken}` },
      });
    } catch {
      // ignore leave errors
    }
  }

  async function backToHome() {
    await leaveRoomIfNeeded();
    clearRoomSession(roomId);
    clearLastRoomId();
    syncRoomToUrl('');
    setRoomId('');
    setSeatToken('');
    setMySide(0);
    setState(initialState);
    setMsg('');
  }

  function alertAndBackHome(message: string) {
    if (roomAlertedRef.current) {
      return;
    }
    roomAlertedRef.current = true;
    window.alert(message);
    void backToHome();
  }

  async function promptJoinWaitingRoom(waitingRoomId: string) {
    if (joinPromptedRoomRef.current === waitingRoomId) {
      return;
    }
    joinPromptedRoomRef.current = waitingRoomId;
    setJoinPromptName(joinName);
    setJoinPromptRoomId(waitingRoomId);
  }

  function closeJoinPrompt() {
    setJoinPromptRoomId(null);
  }

  async function confirmJoinPrompt() {
    if (!joinPromptRoomId) {
      return;
    }
    const nextName = joinPromptName.trim() || joinName;
    setJoinPromptName(nextName);
    setMsg(t('messages.joining'));
    try {
      const payload = await jsonFetch<{ seatToken: string; side: 1 | 2; state: GameState }>(
        apiUrl(`/api/rooms/${joinPromptRoomId}/join`),
        {
          method: 'POST',
          body: JSON.stringify({
            actorType: 'human',
            name: nextName,
            locale: getSystemLocale(),
            clientToken: humanToken,
          }),
        },
      );
      setJoinName(nextName);
      setRoomInput(joinPromptRoomId);
      setRoomId(joinPromptRoomId);
      syncRoomToUrl(joinPromptRoomId);
      setSeatToken(payload.seatToken);
      setMySide(payload.side);
      setState(payload.state);
      saveRoomSession(joinPromptRoomId, payload.seatToken, payload.side);
      setJoinPromptRoomId(null);
      setMsg('');
    } catch (e) {
      setJoinPromptRoomId(null);
      setMsg(`${t('messages.joinFailed')}: ${(e as Error).message}`);
    }
  }

  async function createRoom() {
    setMsg(t('messages.creating'));
    try {
      const payload = await jsonFetch<{ roomId: string; seatToken: string; side: 1 | 2; state: GameState }>(apiUrl('/api/rooms'), {
        method: 'POST',
        body: JSON.stringify({ actorType: 'human', name, locale: getSystemLocale(), clientToken: humanToken }),
      });
      setRoomId(payload.roomId);
      syncRoomToUrl(payload.roomId);
      setSeatToken(payload.seatToken);
      setMySide(payload.side);
      setState(payload.state);
      saveRoomSession(payload.roomId, payload.seatToken, payload.side);
      setMsg('');
    } catch (e) {
      setMsg(`${t('messages.createFailed')}: ${(e as Error).message}`);
    }
  }

  async function joinRoom() {
    const normalizedRoomId = normalizeRoomIdInput(roomInput);
    if (!normalizedRoomId) return;

    setMsg(t('messages.joining'));
    if (await tryRestoreRoomFromSession(normalizedRoomId)) {
      return;
    }
    try {
      const payload = await jsonFetch<{ seatToken: string; side: 1 | 2; state: GameState }>(apiUrl(`/api/rooms/${normalizedRoomId}/join`), {
        method: 'POST',
        body: JSON.stringify({ actorType: 'human', name: joinName, locale: getSystemLocale(), clientToken: humanToken }),
      });
      setRoomInput(normalizedRoomId);
      setRoomId(normalizedRoomId);
      syncRoomToUrl(normalizedRoomId);
      setSeatToken(payload.seatToken);
      setMySide(payload.side);
      setState(payload.state);
      saveRoomSession(normalizedRoomId, payload.seatToken, payload.side);
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
      }>(apiUrl('/api/matchmaking/join'), {
        method: 'POST',
        body: JSON.stringify({ actorType: 'human', name: joinName, locale: getSystemLocale(), clientToken: humanToken }),
      });

      const applyMatch = (payload: { roomId: string; seatToken: string; side: 1 | 2; state: GameState }) => {
        setRoomInput(payload.roomId);
        setRoomId(payload.roomId);
        syncRoomToUrl(payload.roomId);
        setSeatToken(payload.seatToken);
        setMySide(payload.side);
        setState(payload.state);
        saveRoomSession(payload.roomId, payload.seatToken, payload.side);
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
        }>(apiUrl(`/api/matchmaking/${joined.ticketId}`));
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
      const next = await jsonFetch<GameState>(apiUrl(`/api/rooms/${roomId}/move`), {
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

  function formatCountdown(ms: number): string {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  const recentLogs = [...state.decisionLogs].slice(-100);
  const turnRemainingMs =
    state.status === 'playing' && state.turnDeadlineAt
      ? Math.max(0, state.turnDeadlineAt - nowTs)
      : 0;
  const inferredSkillUrl = apiBaseUrl
    ? `${apiBaseUrl}/skill.md`
    : import.meta.env.DEV
      ? `${window.location.protocol}//${window.location.hostname}:8787/skill.md`
      : `${window.location.origin}/skill.md`;
  const skillUrl = inferredSkillUrl;
  const homeAgentPrompt = t('prompts.home', { skillUrl });
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
  const isTwoHumans = state.players.length === 2 && state.players.every((p) => p.actorType === 'human');

  function renderHome() {
    return (
      <div className="home-container">
        <div className="home-card panel">
          <h1 className="title title-pixel" style={{ cursor: 'pointer' }} onClick={backToHome}>ClawGame</h1>
          <p style={{ textAlign: 'center', color: '#94a3b8', marginBottom: '1rem' }}>
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
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
            onClick={backToHome}
          >
            <img src="/logo.svg" alt="Logo" className="room-logo" />
            <h2
              className="title-pixel"
              style={{ margin: 0, fontSize: '1.4rem', display: 'flex', alignItems: 'baseline', gap: '8px' }}
              title={t('room.backHome')}
            >
              ClawGame
              <span style={{ color: 'var(--color-dark)', fontSize: '0.9rem', textShadow: 'none', WebkitTextStroke: '0' }}>
                x 五子棋
              </span>
            </h2>
          </div>
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

        <div className={`game-container ${isTwoHumans ? 'centered' : ''}`}>
          <div className="board-wrapper">
            {showGameStart && (
              <div className="game-start-banner title-pixel">
                {t('room.gameStart')}
              </div>
            )}
            <div className="board-info">
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span className="status-badge">
                  {state.status === 'playing' ? t('room.status.playing') : state.status === 'finished' ? t('room.status.finished') : t('room.status.waiting')}
                </span>
                <span>
                  {t('room.currentTurn')}: {state.currentTurn === 1 ? t('room.blackFirst') : t('room.white')}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span>{t('room.moveCount')}: {state.moves}</span>
                {state.status === 'playing' && (
                  <span style={{ display: 'inline-flex', gap: '4px' }}>
                    {t('room.turnCountdown')}:
                    <span style={{ display: 'inline-block', minWidth: '3.5em', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatCountdown(turnRemainingMs)}
                    </span>
                  </span>
                )}
              </div>
            </div>
            <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center', gap: '24px' }}>
              {state.players.length === 0 ? (
                <span style={{ color: '#64748b' }}>{t('room.noPlayers')}</span>
              ) : (
                state.players.map((p, i) => (
                  <div key={i} className={`player-label ${p.side === 1 ? 'black' : 'white'} ${state.currentTurn === p.side ? 'active' : ''}`}>
                    <Shield size={16} />
                    <span>
                      {p.side === 1 ? t('room.side.blackShort') : t('room.side.whiteShort')}: {p.name} {p.actorType !== 'human' && <Bot size={14} style={{ display: 'inline', marginLeft: 4 }} />}
                    </span>
                  </div>
                ))
              )}
            </div>

            {state.status === 'finished' && !dismissedBanner && (
              <div className="finish-banner">
                <button
                  className="close-banner-btn"
                  onClick={() => setDismissedBanner(true)}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
                {state.winner === 0 ? t('room.draw') : state.winner === 1 ? t('room.winner.black') : t('room.winner.white')}
                {state.finishReason && <span style={{ fontSize: '0.85em', fontWeight: 'normal', display: 'block', marginTop: 4, color: '#94a3b8' }}>{t('room.reason')}: {finishReasonLabel(state.finishReason)}</span>}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div className="board-surface">
                <div className="grid-lines" aria-hidden />
                <div className="grid">
                  {state.board.map((row, y) =>
                    row.map((cell, x) => (
                      <button
                        key={`${x}-${y}`}
                        className={[
                          'cell',
                          x === 0 ? 'edge-left' : '',
                          x === row.length - 1 ? 'edge-right' : '',
                          y === 0 ? 'edge-top' : '',
                          y === state.board.length - 1 ? 'edge-bottom' : '',
                          (x === 3 || x === 11 || x === 7) && (y === 3 || y === 11 || y === 7) ? 'is-hoshi' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => place(x, y)}
                        disabled={cell !== 0 || state.status !== 'playing' || state.currentTurn !== mySide}
                        aria-label={`cell-${x}-${y}`}
                      >
                        {cell !== 0 && (
                          <span className={`stone ${cell === 1 ? 'black' : 'white'}`} />
                        )}
                        {(x === 3 || x === 11 || x === 7) && (y === 3 || y === 11 || y === 7) && (
                          <span className="hoshi-point" />
                        )}
                        {state.lastMove?.x === x && state.lastMove?.y === y && (
                          <span className="last-move-indicator" />
                        )}
                      </button>
                    )),
                  )}
                </div>
              </div>
            </div>

            {msg && <p style={{ color: '#ef4444', textAlign: 'center', marginTop: '1rem' }}>{msg}</p>}
          </div>

          {!isTwoHumans && (
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
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {joinPromptRoomId && (
        <div className="modal-overlay">
          <div className="modal-card panel">
            <h3 style={{ marginBottom: '10px' }}>{t('messages.promptJoinWaitingRoomTitle')}</h3>
            <p style={{ marginTop: 0, marginBottom: '12px', color: '#475569' }}>{t('messages.promptJoinWaitingRoom')}</p>
            <input
              value={joinPromptName}
              onChange={(e) => setJoinPromptName(e.target.value)}
              placeholder={t('home.joinNamePlaceholder')}
              style={{ width: '100%' }}
            />
            <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="secondary" onClick={closeJoinPrompt}>{t('common.cancel')}</button>
              <button onClick={confirmJoinPrompt}><Users size={16} /> {t('home.joinRoom')}</button>
            </div>
          </div>
        </div>
      )}
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
      <footer className="footer">
        <a href="https://github.com/QingWei-Li/clawgame" target="_blank" rel="noopener noreferrer" className="footer-link">
          <Github size={20} />
          <span>GitHub</span>
        </a>
      </footer>
    </>
  );
}
