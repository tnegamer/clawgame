import { useEffect, useState } from 'react';

type Cell = 0 | 1 | 2;
type Status = 'waiting' | 'playing' | 'finished';

type GameState = {
  roomId: string;
  status: Status;
  board: Cell[][];
  currentTurn: 1 | 2;
  winner: 0 | 1 | 2;
  moves: number;
  players: { side: 1 | 2; actorType: 'human' | 'ai'; actorId: string; name: string }[];
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

const emptyBoard = () => Array.from({ length: 15 }, () => Array.from({ length: 15 }, () => 0 as Cell));

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
  const [name, setName] = useState('Human Player');
  const [joinName, setJoinName] = useState('Human Guest');
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
    moves: 0,
    players: [],
    lastMove: null,
    decisionLogs: [],
  });
  const [msg, setMsg] = useState('准备就绪');

  useEffect(() => {
    const presetRoomId = new URLSearchParams(window.location.search).get('roomId');
    if (presetRoomId) {
      setRoomId(presetRoomId);
      setRoomInput(presetRoomId);
      setMsg(`观战模式: ${presetRoomId}`);
    }
  }, []);

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
        setMsg('WebSocket 消息解析失败');
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
  }, [roomId]);

  useEffect(() => {
    (window as any).render_game_to_text = () =>
      JSON.stringify({
        coordinate: 'origin top-left; x right+, y down+',
        roomId,
        state,
        mySide,
      });
    (window as any).advanceTime = (_ms: number) => {
      // React state app relies on network events; hook exists for deterministic test client compatibility.
      return;
    };
  }, [roomId, state, mySide]);

  async function createRoom() {
    try {
      const payload = await jsonFetch<{ roomId: string; seatToken: string; side: 1 | 2; state: GameState }>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ actorType: 'human', name }),
      });
      setRoomId(payload.roomId);
      setSeatToken(payload.seatToken);
      setMySide(payload.side);
      setState(payload.state);
      setMsg(`房间已创建: ${payload.roomId}`);
    } catch (e) {
      setMsg(`创建失败: ${(e as Error).message}`);
    }
  }

  async function joinRoom() {
    try {
      const payload = await jsonFetch<{ seatToken: string; side: 1 | 2; state: GameState }>(`/api/rooms/${roomInput}/join`, {
        method: 'POST',
        body: JSON.stringify({ actorType: 'human', name: joinName }),
      });
      setRoomId(roomInput);
      setSeatToken(payload.seatToken);
      setMySide(payload.side);
      setState(payload.state);
      setMsg(`已加入房间: ${roomInput}`);
    } catch (e) {
      setMsg(`加入失败: ${(e as Error).message}`);
    }
  }

  async function place(x: number, y: number) {
    if (!roomId || !seatToken) {
      return;
    }

    try {
      const next = await jsonFetch<GameState>(`/api/rooms/${roomId}/move`, {
        method: 'POST',
        headers: { authorization: `Bearer ${seatToken}` },
        body: JSON.stringify({ x, y }),
      });
      setState(next);
      setMsg(`落子 (${x}, ${y})`);
    } catch (e) {
      setMsg(`落子失败: ${(e as Error).message}`);
    }
  }

  const recentLogs = [...state.decisionLogs].slice(-40).reverse();

  return (
    <main>
      <h1>ClawGame - 五子棋 AI 对战平台</h1>

      <section className="panel">
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="创建者名称" />
          <button onClick={createRoom}>创建房间</button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input value={roomInput} onChange={(e) => setRoomInput(e.target.value)} placeholder="输入房间号" />
          <input value={joinName} onChange={(e) => setJoinName(e.target.value)} placeholder="加入者名称" />
          <button onClick={joinRoom}>加入房间</button>
        </div>
        <p>模式：人类创建房间后，AI 可通过 API 调用加入。也支持 AI 对 AI。</p>
        <p>当前消息: {msg}</p>
      </section>

      <section className="panel board-layout">
        <div>
          <p>房间: {roomId || '-'}</p>
          <p>
            状态: {state.status} | 当前回合: {state.currentTurn === 1 ? '黑子(先手)' : '白子'} | 已落子: {state.moves}
          </p>
          <p>
            玩家: {state.players.map((p) => `${p.side === 1 ? '黑' : '白'}-${p.name}(${p.actorType})`).join(' vs ') || '-'}
          </p>
          <p>
            结果:{' '}
            {state.status === 'finished'
              ? state.winner === 0
                ? '平局'
                : state.winner === 1
                  ? '黑子胜'
                  : '白子胜'
              : '进行中'}
          </p>
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
                  {cell !== 0 && <span className={`stone ${cell === 1 ? 'black' : 'white'}`} />}
                </button>
              )),
            )}
          </div>
        </div>
        <aside className="log-panel" aria-label="ai-decision-log">
          <h3>AI 决策日志</h3>
          {recentLogs.length === 0 && <p>暂无日志，等待 AI 落子...</p>}
          {recentLogs.map((log) => (
            <div className="log-item" key={`${log.moveNo}-${log.createdAt}`}>
              <div>
                第 {log.moveNo} 手 | {log.side === 1 ? '黑' : '白'} | {log.playerName}
              </div>
              <div>
                落子: ({log.x}, {log.y}) | 来源: {log.source}
              </div>
              <div>{log.thought}</div>
            </div>
          ))}
        </aside>
      </section>
    </main>
  );
}
