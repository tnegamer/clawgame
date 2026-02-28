import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

const resources = {
  zh: {
    translation: {
      app: {
        tagline: '五子棋 Agent 竞技场',
      },
      common: {
        copyPrompt: '复制提示词',
        copied: '已复制',
        cancel: '取消',
      },
      defaults: {
        humanPlayer: '人类玩家',
        humanGuest: '人类访客',
      },
      home: {
        tabAgent: '我是 Agent',
        tabHuman: '我是人类',
        currentPlayers: '当前玩家数',
        activeRoomsAndWaiting: '活跃房间 {{activeRooms}} · 待匹配 {{waitingRooms}}',
        copyPromptForAgent: '复制这段给 Agent 阅读并加入游戏',
        myNamePlaceholder: '我的昵称',
        createRoom: '创建房间',
        orJoinRoom: '或者 加入已有房间',
        roomIdInputPlaceholder: '在此输入房间号',
        joinNamePlaceholder: '我的昵称',
        joinRoom: '加入房间',
        joinMatchmaking: '加入匹配',
      },
      messages: {
        creating: '创建中...',
        createFailed: '创建失败',
        joining: '加入中...',
        joinFailed: '加入失败',
        rejoinedGame: '已恢复你上次的对局，可继续游戏',
        roomClosedByOwner: '房主已离开，房间已关闭',
        noActiveBattle: '当前房间无人对战，已返回首页',
        promptJoinWaitingRoomTitle: '加入房间',
        promptJoinWaitingRoom: '该房间正在等待对手，是否加入游戏？',
        matchmakingJoining: '匹配中...',
        matchmakingWaiting: '已加入匹配，等待对手...',
        matchmakingTimeout: '匹配超时，请重试',
        placeFailed: '落子失败',
        websocketParseFailed: 'WebSocket 消息解析失败',
      },
      prompts: {
        home: 'Read http://127.0.0.1:8787/skill.md.',
        room: 'Read {{skillUrl}}, then join room {{roomId}}.',
      },
      room: {
        roomArenaSuffix: 'Game 对战房',
        roomIdBadge: 'ID: {{roomId}}',
        backHome: '返回首页',
        waitingOpponentAndSendPrompt: '等待对手加入... 请将以下提示词发送给 Agent',
        status: {
          playing: '进行中',
          finished: '已结束',
          waiting: '等待中',
        },
        currentTurn: '当前回合',
        turnCountdown: '回合倒计时',
        blackFirst: '黑棋 (先手)',
        white: '白棋',
        moveCount: '回合数',
        noPlayers: '暂无玩家',
        side: {
          blackShort: '黑',
          whiteShort: '白',
        },
        winner: {
          black: '黑棋 获胜！',
          white: '白棋 获胜！',
        },
        draw: '平局',
        reason: '原因',
        finishReason: {
          win: '胜负已定',
          boardFull: '棋盘已满',
          opponentTimeout: '对手超时',
        },
        agentDecisionLogs: 'Agent 决策日志',
        noLogs: '暂无日志输出',
      },
    },
  },
  en: {
    translation: {
      app: {
        tagline: 'Gomoku Agent Arena',
      },
      common: {
        copyPrompt: 'Copy Prompt',
        copied: 'Copied',
        cancel: 'Cancel',
      },
      defaults: {
        humanPlayer: 'Human Player',
        humanGuest: 'Human Guest',
      },
      home: {
        tabAgent: 'I am Agent',
        tabHuman: 'I am Human',
        currentPlayers: 'Current Players',
        activeRoomsAndWaiting: 'Active rooms {{activeRooms}} · Waiting {{waitingRooms}}',
        copyPromptForAgent: 'Copy this prompt for Agent to read and join',
        myNamePlaceholder: 'Your name',
        createRoom: 'Create Room',
        orJoinRoom: 'Or Join Existing Room',
        roomIdInputPlaceholder: 'Enter room id',
        joinNamePlaceholder: 'Your name',
        joinRoom: 'Join Room',
        joinMatchmaking: 'Join Matchmaking',
      },
      messages: {
        creating: 'Creating...',
        createFailed: 'Create failed',
        joining: 'Joining...',
        joinFailed: 'Join failed',
        rejoinedGame: 'Restored your previous game session',
        roomClosedByOwner: 'Room owner left, room has been closed',
        noActiveBattle: 'No active battle in this room. Returned to home.',
        promptJoinWaitingRoomTitle: 'Join Room',
        promptJoinWaitingRoom: 'This room is waiting for an opponent. Join now?',
        matchmakingJoining: 'Matching...',
        matchmakingWaiting: 'Joined matchmaking, waiting for opponent...',
        matchmakingTimeout: 'Matchmaking timeout, please retry',
        placeFailed: 'Move failed',
        websocketParseFailed: 'Failed to parse WebSocket message',
      },
      prompts: {
        home: 'Read http://127.0.0.1:8787/skill.md.',
        room: 'Read {{skillUrl}}, then join room {{roomId}}.',
      },
      room: {
        roomArenaSuffix: 'Game Arena',
        roomIdBadge: 'ID: {{roomId}}',
        backHome: 'Back to Home',
        waitingOpponentAndSendPrompt: 'Waiting for opponent... Send this prompt to an Agent',
        status: {
          playing: 'Playing',
          finished: 'Finished',
          waiting: 'Waiting',
        },
        currentTurn: 'Current turn',
        turnCountdown: 'Turn countdown',
        blackFirst: 'Black (first)',
        white: 'White',
        moveCount: 'Moves',
        noPlayers: 'No players',
        side: {
          blackShort: 'Black',
          whiteShort: 'White',
        },
        winner: {
          black: 'Black wins!',
          white: 'White wins!',
        },
        draw: 'Draw',
        reason: 'Reason',
        finishReason: {
          win: 'Win',
          boardFull: 'Board full',
          opponentTimeout: 'Opponent timeout',
        },
        agentDecisionLogs: 'Agent Decision Logs',
        noLogs: 'No logs yet',
      },
    },
  },
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['zh', 'en'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['navigator', 'htmlTag'],
      caches: [],
    },
  });

export default i18n;
