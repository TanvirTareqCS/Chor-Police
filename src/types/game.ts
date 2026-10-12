export type GoodRole = "Babu" | "Mantri" | "Kotwal" | "Bicharpoti" | "Police";

export type BadRole = "Chor" | "Dakaat" | "Pocketmar" | "Shinduk-Chor";

export type PlayerRole = GoodRole | BadRole;

export type Team = "good" | "bad" | "police";

export type PlayerStatus = "active" | "left";

export type GamePhase =
  | "waiting"
  | "deal"
  | "chat"
  | "results"
  | "ended";

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  role: PlayerRole | null;
  status: PlayerStatus;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
  isBot: boolean;
  phase: GamePhase;
  round: number;
}

export interface PhaseTimers {
  deal: number;
  chat: number;
}

export interface RoomSettings {
  maxPlayers: number;
  badChitCount: number;
  roundCount: number;
  phaseTimers: PhaseTimers;
}

export interface RoundRecord {
  round: number;
  policeId: string | null;
  accused: string[];
  correct: boolean;
  caughtBadIds: string[];
  undetectedBadIds: string[];
  wrongIds: string[];
  scores: Record<string, number>;
  revealedRoles: Record<string, PlayerRole>;
}

export interface RoomState {
  roomId: string;
  hostId: string;
  phase: GamePhase;
  round: number;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  settings: RoomSettings;
  players: Record<string, Player>;
  chat: Record<string, ChatMessage>;
  ready: Record<string, boolean>;
  phaseStartTime: number | null;
  phaseDuration: number | null;
  policeId: string | null;
  badCount: number;
  accused: Record<string, boolean>;
  accusationSubmitted: boolean;
  results: Record<string, number> | null;
  totalScores: Record<string, number>;
  history: Record<string, RoundRecord>;
}

export interface RoleMeta {
  role: PlayerRole;
  label: string;
  team: Team;
  points: number;
  emoji: string;
  accent: string;
  blurb: string;
}

export interface BotChatRequestBody {
  action: "chat" | "accuse";
  roomId: string;
  botId: string;
  botName: string;
  botRole: PlayerRole | null;
  phase: GamePhase;
  round: number;
  policeId: string | null;
  players: Array<{
    id: string;
    name: string;
    isBot: boolean;
    isPolice: boolean;
    isCandidate?: boolean;
  }>;
  recentMessages: Array<{
    playerId: string;
    playerName: string;
    message: string;
    isBot: boolean;
  }>;
  candidates?: string[];
  accuseCount?: number;
}

export interface BotChatResponse {
  message?: string;
  accusedIds?: string[];
  source?: "llm" | "fallback";
}
