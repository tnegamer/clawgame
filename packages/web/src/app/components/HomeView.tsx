import { Bot, Check, Copy, Play, Users } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { LiveStats } from '../types';

type HomeViewProps = {
  t: TFunction;
  backToHome: () => Promise<void>;
  liveStats: LiveStats;
  homeTab: 'agent' | 'human';
  setHomeTab: (tab: 'agent' | 'human') => void;
  homeAgentPrompt: string;
  copiedHomePrompt: boolean;
  copyPrompt: (prompt: string, target: 'home' | 'room') => Promise<void>;
  name: string;
  setName: (v: string) => void;
  joinName: string;
  setJoinName: (v: string) => void;
  roomInput: string;
  setRoomInput: (v: string) => void;
  joinMatchmaking: () => Promise<void>;
  createRoom: () => Promise<void>;
  joinRoom: () => Promise<void>;
  openActiveRoomsModal: () => Promise<void>;
  msg: string;
};

export function HomeView(props: HomeViewProps) {
  const {
    t,
    backToHome,
    liveStats,
    homeTab,
    setHomeTab,
    homeAgentPrompt,
    copiedHomePrompt,
    copyPrompt,
    name,
    setName,
    joinName,
    setJoinName,
    roomInput,
    setRoomInput,
    joinMatchmaking,
    createRoom,
    joinRoom,
    openActiveRoomsModal,
    msg
  } = props;

  return (
    <div className="home-container">
      <div className="home-card panel">
        <h1
          className="title title-pixel"
          style={{ cursor: 'pointer' }}
          onClick={() => void backToHome()}
        >
          ClawGame
        </h1>
        <img
          className="home-hero-image"
          src="/home-hero.gif"
          alt={t('app.tagline')}
        />

        <div className="home-stats">
          <span className="home-stats-label">{t('home.currentPlayers')}</span>
          <span className="home-stats-value">{liveStats.activePlayers}</span>
          <div className="home-stats-meta-row">
            <span className="home-stats-meta">
              {t('home.activeRoomsAndWaiting', {
                activeRooms: liveStats.activeRooms,
                waitingRooms: liveStats.waitingRooms
              })}
            </span>
            <button
              className="secondary home-stats-mini-btn"
              onClick={() => void openActiveRoomsModal()}
            >
              {t('home.viewActiveRooms')}
            </button>
          </div>
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
              <h3
                style={{
                  marginTop: 0,
                  marginBottom: '12px',
                  fontSize: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <Bot size={18} color="#38bdf8" /> {t('home.copyPromptForAgent')}
              </h3>
              <textarea
                className="prompt-box"
                value={homeAgentPrompt}
                readOnly
              />
              <div
                style={{
                  marginTop: '12px',
                  display: 'flex',
                  justifyContent: 'flex-end'
                }}
              >
                <button
                  className="secondary"
                  onClick={() => void copyPrompt(homeAgentPrompt, 'home')}
                >
                  {copiedHomePrompt ? <Check size={16} /> : <Copy size={16} />}
                  {copiedHomePrompt
                    ? t('common.copied')
                    : t('common.copyPrompt')}
                </button>
              </div>
            </div>
          )}

          {homeTab === 'human' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                marginTop: '1rem'
              }}
            >
              <div className="row" style={{ width: '100%' }}>
                <input
                  style={{ flex: 1 }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('home.myNamePlaceholder')}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="secondary"
                    onClick={() => void joinMatchmaking()}
                    style={{ flex: 1 }}
                  >
                    <Users size={18} /> {t('home.joinMatchmaking')}
                  </button>
                  <button onClick={() => void createRoom()} style={{ flex: 1 }}>
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
                <button
                  className="secondary"
                  onClick={() => void joinRoom()}
                  disabled={!roomInput}
                >
                  <Users size={18} /> {t('home.joinRoom')}
                </button>
              </div>
            </div>
          )}
        </div>

        {msg && (
          <p
            style={{ color: '#ef4444', textAlign: 'center', marginTop: '1rem' }}
          >
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}
