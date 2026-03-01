import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import confetti from 'canvas-confetti';
import { FooterLink } from './app/components/FooterLink';
import { HomeView } from './app/components/HomeView';
import { Modals } from './app/components/Modals';
import { RoomView } from './app/components/RoomView';
import { ShellControls } from './app/components/ShellControls';
import { initialState, LANGUAGE_KEY, THEME_KEY } from './app/types';
import type { ActiveRoomSummary, GameState, LiveStats } from './app/types';
import { finishReasonLabel, finishResultTitle, getSystemLocale, normalizeRoomIdInput } from './app/utils/misc';
import { apiUrl, authHeaders, jsonFetch, wsUrl } from './app/utils/net';
import { clearLastRoomId, clearRoomSession, getOrCreateHumanToken, loadLastRoomId, loadRoomSession, saveLastRoomId, saveRoomSession } from './app/utils/storage';

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
  const [copiedRoomId, setCopiedRoomId] = useState(false);
  const [liveStats, setLiveStats] = useState<LiveStats>({ activePlayers: 0, activeRooms: 0, waitingRooms: 0 });
  const [homeTab, setHomeTab] = useState<'agent' | 'human'>('agent');
  const [nowTs, setNowTs] = useState(Date.now());
  const [joinPromptRoomId, setJoinPromptRoomId] = useState<string | null>(null);
  const [joinPromptName, setJoinPromptName] = useState('');
  const [dismissedBanner, setDismissedBanner] = useState(false);
  const [showGameStart, setShowGameStart] = useState(false);
  const [activeRoomsModalOpen, setActiveRoomsModalOpen] = useState(false);
  const [activeRoomsList, setActiveRoomsList] = useState<ActiveRoomSummary[]>([]);
  const [activeRoomsLoading, setActiveRoomsLoading] = useState(false);
  const [activeRoomsError, setActiveRoomsError] = useState('');
  const [spectatingMode, setSpectatingMode] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const roomAlertedRef = useRef(false);
  const joinPromptedRoomRef = useRef<string | null>(null);
  const roomWsRef = useRef<WebSocket | null>(null);
  const moveReqSeqRef = useRef(0);
  const roomIdCopiedTimerRef = useRef<number | null>(null);
  const pendingMoveRef = useRef(new Map<string, { resolve: (s: GameState) => void; reject: (e: Error) => void; timer: number }>());

  const syncRoomToUrl = useCallback((nextRoomId: string) => {
    const url = new URL(window.location.href);
    if (nextRoomId) url.searchParams.set('roomId', nextRoomId); else url.searchParams.delete('roomId');
    window.history.replaceState({}, '', url.toString());
  }, []);

  const leaveRoomIfNeeded = useCallback(async () => {
    if (!roomId || !seatToken) return;
    try { await fetch(apiUrl(`/api/rooms/${roomId}/leave`), { method: 'POST', headers: { authorization: `Bearer ${seatToken}` } }); }
    catch { /* ignore leave errors */ }
  }, [roomId, seatToken]);

  const backToHome = useCallback(async () => {
    await leaveRoomIfNeeded(); clearRoomSession(roomId); clearLastRoomId(); syncRoomToUrl(''); setRoomId(''); setSeatToken(''); setMySide(0); setState(initialState); setMsg(''); setSpectatingMode(false);
  }, [leaveRoomIfNeeded, roomId, syncRoomToUrl]);

  const alertAndBackHome = useCallback((message: string) => {
    if (roomAlertedRef.current) return;
    roomAlertedRef.current = true;
    window.alert(message);
    void backToHome();
  }, [backToHome]);

  const promptJoinWaitingRoom = useCallback(async (waitingRoomId: string) => {
    if (joinPromptedRoomRef.current === waitingRoomId) return;
    joinPromptedRoomRef.current = waitingRoomId;
    setJoinPromptName(joinName);
    setJoinPromptRoomId(waitingRoomId);
  }, [joinName]);

  const tryRestoreRoomFromSession = useCallback(async (nextRoomId: string): Promise<boolean> => {
    const savedSession = loadRoomSession(nextRoomId);
    if (!savedSession) return false;
    try {
      const restoredState = await jsonFetch<GameState>(apiUrl(`/api/rooms/${nextRoomId}/state`), { headers: authHeaders(savedSession.seatToken) });
      setRoomId(nextRoomId); setRoomInput(nextRoomId); setSeatToken(savedSession.seatToken); setMySide(savedSession.mySide); setState(restoredState);
      syncRoomToUrl(nextRoomId); saveLastRoomId(nextRoomId); setMsg(t('messages.rejoinedGame')); return true;
    } catch { clearRoomSession(nextRoomId); return false; }
  }, [syncRoomToUrl, t]);

  const toggleTheme = () => setTheme((v) => (v === 'light' ? 'dark' : 'light'));
  const toggleLanguage = () => { const next = i18n.language.startsWith('zh') ? 'en' : 'zh'; void i18n.changeLanguage(next); localStorage.setItem(LANGUAGE_KEY, next); };

  useEffect(() => { if (state.status !== 'finished') setDismissedBanner(false); }, [state.status]);
  useEffect(() => { if (state.status === 'playing' && state.moves === 0) { setShowGameStart(true); const timer = setTimeout(() => setShowGameStart(false), 2000); return () => clearTimeout(timer); } }, [state.moves, state.status]);
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem(THEME_KEY, theme); }, [theme]);
  useEffect(() => { const saved = localStorage.getItem(LANGUAGE_KEY); if (saved === 'zh' || saved === 'en') { if (!i18n.language.startsWith(saved)) void i18n.changeLanguage(saved); return; } localStorage.setItem(LANGUAGE_KEY, i18n.language.startsWith('zh') ? 'zh' : 'en'); }, [i18n]);
  useEffect(() => () => { if (roomIdCopiedTimerRef.current) window.clearTimeout(roomIdCopiedTimerRef.current); }, []);

  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get('roomId') ?? '';
    const initialRoomId = preset || loadLastRoomId();
    if (!initialRoomId) return;
    setRoomId(initialRoomId); setRoomInput(initialRoomId); void tryRestoreRoomFromSession(initialRoomId);
  }, [tryRestoreRoomFromSession]);

  useEffect(() => { if (!roomId || !seatToken || (mySide !== 1 && mySide !== 2)) return; saveRoomSession(roomId, seatToken, mySide); saveLastRoomId(roomId); }, [mySide, roomId, seatToken]);
  useEffect(() => { if (!roomId || state.status !== 'finished') return; clearRoomSession(roomId); clearLastRoomId(); }, [roomId, state.status]);

  useEffect(() => {
    const ws = new WebSocket(wsUrl('/ws?live=1'));
    const requestLive = () => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'live_request' })); };
    ws.onopen = requestLive;
    ws.onmessage = (evt) => {
      try {
        const p = JSON.parse(evt.data) as { type: string; activePlayers?: number; activeRooms?: number; waitingRooms?: number };
        if (p.type !== 'live') return;
        setLiveStats({ activePlayers: p.activePlayers ?? 0, activeRooms: p.activeRooms ?? 0, waitingRooms: p.waitingRooms ?? 0 });
      } catch { /* ignore malformed websocket payload */ }
    };
    const timer = setInterval(requestLive, 5000);
    return () => { clearInterval(timer); ws.close(); };
  }, []);

  useEffect(() => {
    if (!roomId) return;
    const ws = new WebSocket(wsUrl(`/ws?roomId=${roomId}`));
    roomWsRef.current = ws;
    const pendingMap = pendingMoveRef.current;

    ws.onmessage = (evt) => {
      try {
        const p = JSON.parse(evt.data) as { type: string; state?: GameState; requestId?: string; ok?: boolean; status?: number; error?: string };
        if (p.type === 'state') { if (p.state) setState(p.state); return; }
        if (p.type === 'move_result') {
          const requestId = p.requestId ?? '';
          const pending = pendingMap.get(requestId);
          if (!pending) return;
          clearTimeout(pending.timer);
          pendingMap.delete(requestId);
          if (p.ok && p.state) pending.resolve(p.state); else pending.reject(new Error(p.error ?? `move failed (${p.status ?? 500})`));
          return;
        }
        if (p.type === 'room_closed') { clearRoomSession(roomId); clearLastRoomId(); alertAndBackHome(t('messages.roomClosedByOwner')); }
      } catch { setMsg(t('messages.websocketParseFailed')); }
    };

    return () => {
      if (roomWsRef.current === ws) roomWsRef.current = null;
      for (const [, pending] of pendingMap) { clearTimeout(pending.timer); pending.reject(new Error('room connection closed')); }
      pendingMap.clear();
      ws.close();
    };
  }, [alertAndBackHome, roomId, t]);

  useEffect(() => { if (mySide !== 0) setSpectatingMode(false); }, [mySide]);
  useEffect(() => { if (!roomId || mySide !== 0 || spectatingMode) return; if (state.status === 'waiting' && state.players.length === 1) { void promptJoinWaitingRoom(roomId); return; } if (state.status !== 'waiting') joinPromptedRoomRef.current = null; }, [mySide, promptJoinWaitingRoom, roomId, spectatingMode, state.players.length, state.status]);
  useEffect(() => { if (state.status !== 'playing') return; const timer = setInterval(() => setNowTs(Date.now()), 250); return () => clearInterval(timer); }, [state.status]);

  useEffect(() => {
    if (state.status !== 'finished' || mySide === 0) return;
    if (state.winner === mySide) {
      const end = Date.now() + 2500;
      const frame = () => {
        confetti({ particleCount: 6, angle: 60, spread: 80, origin: { x: 0, y: 0.6 }, colors: ['#38bdf8', '#818cf8', '#a78bfa', '#f472b6', '#fb923c', '#fbbf24'] });
        confetti({ particleCount: 6, angle: 120, spread: 80, origin: { x: 1, y: 0.6 }, colors: ['#38bdf8', '#818cf8', '#a78bfa', '#f472b6', '#fb923c', '#fbbf24'] });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();
    } else if (state.winner !== 0) {
      confetti({ particleCount: 100, spread: 120, origin: { y: -0.1 }, colors: ['#cbd5e1', '#94a3b8', '#64748b', '#475569'], gravity: 0.5, ticks: 300, startVelocity: 20 });
    } else {
      confetti({ particleCount: 100, spread: 100, origin: { y: 0.5 }, colors: ['#fcd34d', '#fbbf24', '#f59e0b'] });
    }
  }, [mySide, state.status, state.winner]);

  useEffect(() => {
    const debugWindow = window as Window & { render_game_to_text?: () => string; advanceTime?: (ms: number) => void };
    debugWindow.render_game_to_text = () => JSON.stringify({ coordinate: 'origin top-left; x right+, y down+', roomId, state, mySide });
    debugWindow.advanceTime = (ms: number) => { void ms; };
  }, [mySide, roomId, state]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!roomId || state.status !== 'playing' || mySide === 0) return;
      if (seatToken) void fetch(apiUrl(`/api/rooms/${roomId}/leave`), { method: 'POST', headers: { authorization: `Bearer ${seatToken}` }, keepalive: true });
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [mySide, roomId, seatToken, state.status]);

  function closeJoinPrompt() { setJoinPromptRoomId(null); }

  async function confirmJoinPrompt() {
    if (!joinPromptRoomId) return;
    const nextName = joinPromptName.trim() || joinName;
    setJoinPromptName(nextName); setMsg(t('messages.joining'));
    try {
      const payload = await jsonFetch<{ seatToken: string; side: 1 | 2; state: GameState }>(apiUrl(`/api/rooms/${joinPromptRoomId}/join`), { method: 'POST', body: JSON.stringify({ actorType: 'human', name: nextName, locale: getSystemLocale(), clientToken: humanToken }) });
      setJoinName(nextName); setRoomInput(joinPromptRoomId); setRoomId(joinPromptRoomId); syncRoomToUrl(joinPromptRoomId); setSeatToken(payload.seatToken); setMySide(payload.side); setState(payload.state); saveRoomSession(joinPromptRoomId, payload.seatToken, payload.side); setJoinPromptRoomId(null); setMsg('');
    } catch (e) { setJoinPromptRoomId(null); setMsg(`${t('messages.joinFailed')}: ${(e as Error).message}`); }
  }

  async function createRoom() {
    setMsg(t('messages.creating'));
    try {
      const payload = await jsonFetch<{ roomId: string; seatToken: string; side: 1 | 2; state: GameState }>(apiUrl('/api/rooms'), { method: 'POST', body: JSON.stringify({ actorType: 'human', name, locale: getSystemLocale(), clientToken: humanToken }) });
      setRoomId(payload.roomId); syncRoomToUrl(payload.roomId); setSeatToken(payload.seatToken); setMySide(payload.side); setSpectatingMode(false); setState(payload.state); saveRoomSession(payload.roomId, payload.seatToken, payload.side); setMsg('');
    } catch (e) { setMsg(`${t('messages.createFailed')}: ${(e as Error).message}`); }
  }

  async function joinRoom() {
    const normalizedRoomId = normalizeRoomIdInput(roomInput);
    if (!normalizedRoomId) return;
    setMsg(t('messages.joining'));
    if (await tryRestoreRoomFromSession(normalizedRoomId)) return;
    try {
      const payload = await jsonFetch<{ seatToken: string; side: 1 | 2; state: GameState }>(apiUrl(`/api/rooms/${normalizedRoomId}/join`), { method: 'POST', body: JSON.stringify({ actorType: 'human', name: joinName, locale: getSystemLocale(), clientToken: humanToken }) });
      setRoomInput(normalizedRoomId); setRoomId(normalizedRoomId); syncRoomToUrl(normalizedRoomId); setSeatToken(payload.seatToken); setMySide(payload.side); setSpectatingMode(false); setState(payload.state); saveRoomSession(normalizedRoomId, payload.seatToken, payload.side); setMsg('');
    } catch (e) { setMsg(`${t('messages.joinFailed')}: ${(e as Error).message}`); }
  }

  async function joinMatchmaking() {
    setMsg(t('messages.matchmakingJoining'));
    try {
      const joined = await jsonFetch<{ matched: boolean; ticketId: string; roomId?: string; seatToken?: string; side?: 1 | 2; state?: GameState }>(apiUrl('/api/matchmaking/join'), { method: 'POST', body: JSON.stringify({ actorType: 'human', name: joinName, locale: getSystemLocale(), clientToken: humanToken }) });
      const applyMatch = (p: { roomId: string; seatToken: string; side: 1 | 2; state: GameState }) => { setRoomInput(p.roomId); setRoomId(p.roomId); syncRoomToUrl(p.roomId); setSeatToken(p.seatToken); setMySide(p.side); setSpectatingMode(false); setState(p.state); saveRoomSession(p.roomId, p.seatToken, p.side); setMsg(''); };
      if (joined.matched && joined.roomId && joined.seatToken && joined.side && joined.state) { applyMatch({ roomId: joined.roomId, seatToken: joined.seatToken, side: joined.side, state: joined.state }); return; }
      if (!joined.ticketId) throw new Error('missing ticket id');
      setMsg(t('messages.matchmakingWaiting'));
      const matched = await new Promise<{ roomId: string; seatToken: string; side: 1 | 2; state: GameState }>((resolve, reject) => {
        const ws = new WebSocket(wsUrl(`/ws?ticketId=${joined.ticketId}`));
        const timer = setTimeout(() => { ws.close(); reject(new Error(t('messages.matchmakingTimeout'))); }, 120_000);
        ws.onmessage = (evt) => {
          try {
            const p = JSON.parse(evt.data) as { type: string; matched?: boolean; roomId?: string; seatToken?: string; side?: 1 | 2; state?: GameState };
            if (p.type === 'matchmaking' && p.matched && p.roomId && p.seatToken && p.side && p.state) { clearTimeout(timer); ws.close(); resolve({ roomId: p.roomId, seatToken: p.seatToken, side: p.side, state: p.state }); }
          } catch { /* ignore malformed websocket payload */ }
        };
        ws.onerror = () => { clearTimeout(timer); ws.close(); reject(new Error(t('messages.matchmakingTimeout'))); };
      });
      applyMatch(matched);
    } catch (e) { setMsg(`${t('messages.joinFailed')}: ${(e as Error).message}`); }
  }

  async function place(x: number, y: number) {
    if (!roomId || !seatToken) return;
    const ws = roomWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { setMsg(t('messages.websocketParseFailed')); return; }
    try {
      const requestId = `${Date.now()}-${++moveReqSeqRef.current}`;
      const next = await new Promise<GameState>((resolve, reject) => {
        const timer = window.setTimeout(() => { pendingMoveRef.current.delete(requestId); reject(new Error('move request timeout')); }, 10_000);
        pendingMoveRef.current.set(requestId, { resolve, reject, timer });
        ws.send(JSON.stringify({ type: 'move', requestId, roomId, seatToken, x, y }));
      });
      setState(next); setMsg('');
    } catch (e) { setMsg(`${t('messages.placeFailed')}: ${(e as Error).message}`); }
  }

  const skillUrl = `${window.location.origin}/skill.md`;
  const homeAgentPrompt = t('prompts.home', { skillUrl });
  const roomAgentPrompt = roomId ? t('prompts.room', { skillUrl, roomId }) : '';
  const recentLogs = [...state.decisionLogs].slice(-100);
  const turnRemainingMs = state.status === 'playing' && state.turnDeadlineAt ? Math.max(0, state.turnDeadlineAt - nowTs) : 0;
  const waitingForOpponent = state.players.length < 2 && state.status === 'waiting';
  const isTwoHumans = state.players.length === 2 && state.players.every((p) => p.actorType === 'human');
  const isZh = i18n.language.startsWith('zh');

  async function copyPrompt(prompt: string, target: 'home' | 'room') { if (!prompt) return; await navigator.clipboard.writeText(prompt); if (target === 'home') { setCopiedHomePrompt(true); setTimeout(() => setCopiedHomePrompt(false), 1500); return; } setCopiedRoomPrompt(true); setTimeout(() => setCopiedRoomPrompt(false), 1500); }
  async function copyRoomIdBadge() { if (!roomId) return; try { await navigator.clipboard.writeText(roomId); setCopiedRoomId(true); if (roomIdCopiedTimerRef.current) window.clearTimeout(roomIdCopiedTimerRef.current); roomIdCopiedTimerRef.current = window.setTimeout(() => { setCopiedRoomId(false); roomIdCopiedTimerRef.current = null; }, 1200); } catch { setMsg(t('messages.copyFailed', '复制失败，请重试')); } }
  async function openActiveRoomsModal() { setActiveRoomsModalOpen(true); setActiveRoomsError(''); setActiveRoomsLoading(true); try { const payload = await jsonFetch<{ activeRooms: ActiveRoomSummary[] }>(apiUrl('/api/rooms/active')); setActiveRoomsList(payload.activeRooms ?? []); } catch (e) { setActiveRoomsError((e as Error).message); } finally { setActiveRoomsLoading(false); } }
  function closeActiveRoomsModal() { setActiveRoomsModalOpen(false); setActiveRoomsError(''); }
  async function spectateRoom(targetRoomId: string) { try { setMsg(t('messages.joining')); const roomState = await jsonFetch<GameState>(apiUrl(`/api/rooms/${targetRoomId}/state`)); setRoomInput(targetRoomId); setRoomId(targetRoomId); syncRoomToUrl(targetRoomId); setSeatToken(''); setMySide(0); setSpectatingMode(true); setState(roomState); setActiveRoomsModalOpen(false); setMsg(''); } catch (e) { const m = `${t('messages.joinFailed')}: ${(e as Error).message}`; setActiveRoomsError(m); setMsg(m); } }

  return (
    <>
      <Modals t={t} joinPromptRoomId={joinPromptRoomId} joinPromptName={joinPromptName} setJoinPromptName={setJoinPromptName} closeJoinPrompt={closeJoinPrompt} confirmJoinPrompt={confirmJoinPrompt} activeRoomsModalOpen={activeRoomsModalOpen} closeActiveRoomsModal={closeActiveRoomsModal} activeRoomsLoading={activeRoomsLoading} activeRoomsError={activeRoomsError} activeRoomsList={activeRoomsList} spectateRoom={spectateRoom} />
      <ShellControls darkMode={theme === 'dark'} isZh={isZh} toggleTheme={toggleTheme} toggleLanguage={toggleLanguage} />
      {!roomId ? (
        <HomeView t={t} backToHome={backToHome} liveStats={liveStats} homeTab={homeTab} setHomeTab={setHomeTab} homeAgentPrompt={homeAgentPrompt} copiedHomePrompt={copiedHomePrompt} copyPrompt={copyPrompt} name={name} setName={setName} joinName={joinName} setJoinName={setJoinName} roomInput={roomInput} setRoomInput={setRoomInput} joinMatchmaking={joinMatchmaking} createRoom={createRoom} joinRoom={joinRoom} openActiveRoomsModal={openActiveRoomsModal} msg={msg} />
      ) : (
        <RoomView t={t} roomId={roomId} state={state} mySide={mySide} msg={msg} showGameStart={showGameStart} copiedRoomId={copiedRoomId} copiedRoomPrompt={copiedRoomPrompt} dismissedBanner={dismissedBanner} recentLogs={recentLogs} waitingForOpponent={waitingForOpponent} isTwoHumans={isTwoHumans} roomAgentPrompt={roomAgentPrompt} turnRemainingMs={turnRemainingMs} backToHome={backToHome} copyRoomIdBadge={copyRoomIdBadge} copyPrompt={copyPrompt} place={place} setDismissedBanner={setDismissedBanner} finishResultTitle={() => finishResultTitle(state, mySide, t)} finishReasonLabel={(reason) => finishReasonLabel(reason, mySide, state, t)} />
      )}
      <FooterLink />
    </>
  );
}
