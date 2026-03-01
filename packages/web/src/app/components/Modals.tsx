import { Users, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ActiveRoomSummary } from '../types';

type ModalsProps = {
  t: TFunction;
  joinPromptRoomId: string | null;
  joinPromptName: string;
  setJoinPromptName: (v: string) => void;
  closeJoinPrompt: () => void;
  confirmJoinPrompt: () => Promise<void>;
  activeRoomsModalOpen: boolean;
  closeActiveRoomsModal: () => void;
  activeRoomsLoading: boolean;
  activeRoomsError: string;
  activeRoomsList: ActiveRoomSummary[];
  spectateRoom: (roomId: string) => Promise<void>;
};

export function Modals(props: ModalsProps) {
  const {
    t,
    joinPromptRoomId,
    joinPromptName,
    setJoinPromptName,
    closeJoinPrompt,
    confirmJoinPrompt,
    activeRoomsModalOpen,
    closeActiveRoomsModal,
    activeRoomsLoading,
    activeRoomsError,
    activeRoomsList,
    spectateRoom,
  } = props;

  return (
    <>
      {joinPromptRoomId && (
        <div className="modal-overlay">
          <div className="modal-card panel">
            <h3 style={{ marginBottom: '10px' }}>{t('messages.promptJoinWaitingRoomTitle')}</h3>
            <p style={{ marginTop: 0, marginBottom: '12px', color: '#475569' }}>{t('messages.promptJoinWaitingRoom')}</p>
            <input value={joinPromptName} onChange={(e) => setJoinPromptName(e.target.value)} placeholder={t('home.joinNamePlaceholder')} style={{ width: '100%' }} />
            <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="secondary" onClick={closeJoinPrompt}>{t('common.cancel')}</button>
              <button onClick={() => void confirmJoinPrompt()}><Users size={16} /> {t('home.joinRoom')}</button>
            </div>
          </div>
        </div>
      )}

      {activeRoomsModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card panel">
            <div className="modal-title-row">
              <h3 style={{ margin: 0 }}>{t('home.activeRoomsModalTitle')}</h3>
              <button className="secondary modal-close-btn" onClick={closeActiveRoomsModal}><X size={14} /> {t('common.cancel')}</button>
            </div>
            <div className="active-rooms-list">
              {activeRoomsLoading && <p className="active-rooms-empty">{t('messages.joining')}</p>}
              {!activeRoomsLoading && activeRoomsError && <p className="active-rooms-error">{activeRoomsError}</p>}
              {!activeRoomsLoading && !activeRoomsError && activeRoomsList.length === 0 && <p className="active-rooms-empty">{t('home.noActiveRooms')}</p>}
              {!activeRoomsLoading && !activeRoomsError && activeRoomsList.map((item) => (
                <div key={item.roomId} className="active-room-item">
                  <div className="active-room-main">
                    <div className="active-room-id">{item.roomId}</div>
                    <div className="active-room-meta">{t(`room.status.${item.status}`)} · {item.players.map((p) => p.name).join(' vs ')}</div>
                  </div>
                  <button className="secondary" onClick={() => void spectateRoom(item.roomId)}>{t('home.spectate')}</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
