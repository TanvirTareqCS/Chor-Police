import type {
  BadRole,
  GamePhase,
  GoodRole,
  Player,
  PlayerRole,
  RoleMeta,
  RoomSettings,
} from "@/types/game";

export const BAD_ROLES: BadRole[] = [
  "Chor",
  "Dakaat",
  "Pocketmar",
  "Shinduk-Chor",
];

export const GUARANTEED_POINTS: Record<GoodRole, number> = {
  Babu: 1000,
  Mantri: 800,
  Kotwal: 600,
  Bicharpoti: 400,
  Police: 500,
};

export const ROLE_META: Record<PlayerRole, RoleMeta> = {
  Babu: {
    role: "Babu",
    label: "Babu (King)",
    team: "good",
    points: 1000,
    emoji: "👑",
    accent: "border-amber-400/60 bg-amber-500/10 text-amber-200",
    blurb: "The King. Guaranteed 1000 points each round.",
  },
  Mantri: {
    role: "Mantri",
    label: "Mantri (Minister)",
    team: "good",
    points: 800,
    emoji: "🎩",
    accent: "border-emerald-400/60 bg-emerald-500/10 text-emerald-200",
    blurb: "The Minister. Guaranteed 800 points each round.",
  },
  Kotwal: {
    role: "Kotwal",
    label: "Kotwal (Guard)",
    team: "good",
    points: 600,
    emoji: "🛡️",
    accent: "border-sky-400/60 bg-sky-500/10 text-sky-200",
    blurb: "The Guard. Guaranteed 600 points each round.",
  },
  Bicharpoti: {
    role: "Bicharpoti",
    label: "Bicharpoti (Judge)",
    team: "good",
    points: 400,
    emoji: "⚖️",
    accent: "border-violet-400/60 bg-violet-500/10 text-violet-200",
    blurb: "The Judge. Guaranteed 400 points each round.",
  },
  Police: {
    role: "Police",
    label: "Police",
    team: "police",
    points: 500,
    emoji: "🚔",
    accent: "border-blue-400/60 bg-blue-500/10 text-blue-200",
    blurb:
      "Publicly revealed. Catch every Bad Chit in Phase 4 for 500 points, or get nothing.",
  },
  Chor: {
    role: "Chor",
    label: "Chor (Thief)",
    team: "bad",
    points: 0,
    emoji: "🥷",
    accent: "border-red-400/60 bg-red-500/10 text-red-200",
    blurb: "A Bad Chit. Survive the Police to split 500 points.",
  },
  Dakaat: {
    role: "Dakaat",
    label: "Dakaat (Robber)",
    team: "bad",
    points: 0,
    emoji: "🔫",
    accent: "border-rose-400/60 bg-rose-500/10 text-rose-200",
    blurb: "A Bad Chit. Survive the Police to split 500 points.",
  },
  Pocketmar: {
    role: "Pocketmar",
    label: "Pocketmar (Pickpocket)",
    team: "bad",
    points: 0,
    emoji: "🤏",
    accent: "border-orange-400/60 bg-orange-500/10 text-orange-200",
    blurb: "A Bad Chit. Survive the Police to split 500 points.",
  },
  "Shinduk-Chor": {
    role: "Shinduk-Chor",
    label: "Shinduk-Chor (Safe Cracker)",
    team: "bad",
    points: 0,
    emoji: "🧰",
    accent: "border-pink-400/60 bg-pink-500/10 text-pink-200",
    blurb: "A Bad Chit. Survive the Police to split 500 points.",
  },
};

export const PHASE_ORDER: GamePhase[] = ["deal", "chat"];

export const PHASE_LABELS: Record<GamePhase, string> = {
  waiting: "Lobby",
  deal: "Phase 1 · The Deal",
  chat: "Phase 2 · Interrogation",
  results: "Payout & Leaderboard",
  ended: "Game Over",
};

export const PHASE_HINTS: Record<GamePhase, string> = {
  waiting: "Waiting for the host to begin.",
  deal: "Chits are dealt face-down. Only your own chit is visible. Police is revealed.",
  chat: "Interrogate, deflect and accuse in the live chat. The Police may lock an accusation at any moment.",
  results: "Points have been paid out. Round scores and standings below.",
  ended: "All rounds complete. Final leaderboard below.",
};

export const RESULTS_DURATION = 8;

export function isBadRole(role: PlayerRole | null): role is BadRole {
  return role !== null && (BAD_ROLES as string[]).includes(role);
}

export function isGoodRole(role: PlayerRole | null): role is GoodRole {
  return role !== null && role in GUARANTEED_POINTS;
}

export const GOOD_ROLE_POOL: GoodRole[] = [
  "Babu",
  "Police",
  "Mantri",
  "Kotwal",
  "Bicharpoti",
];

/** Minimum / maximum Bad-Chit counts that still fill every seat with a role. */
export function getBadChitRange(playerCount: number): {
  min: number;
  max: number;
} {
  const count = Math.max(4, Math.min(8, playerCount));
  const min = Math.max(1, count - GOOD_ROLE_POOL.length);
  const max = Math.min(BAD_ROLES.length, count - 2);
  return { min, max };
}

/**
 * Role pool scaling.
 *
 * Every seat always receives exactly one real chit — no blanks. The good pool is
 * filled in priority order (Babu and Police always present) and the remaining
 * seats become Bad Chits, so a 4-player game with 1 Bad Chit is
 * Babu + Police + Mantri + Chor. The host's `badChitCount` is clamped to the
 * range that keeps at least Babu + Police on the good side and never needs more
 * distinct good/bad names than exist.
 */
export function getRoleDistribution(
  playerCount: number,
  badChitCountOverride?: number
): { good: GoodRole[]; bad: BadRole[]; all: PlayerRole[] } {
  const count = Math.max(4, Math.min(8, playerCount));
  const { min, max } = getBadChitRange(count);

  const defaultBad = count <= 6 ? 2 : count === 7 ? 3 : 4;
  const requested = badChitCountOverride ?? defaultBad;
  const badCount = Math.max(min, Math.min(requested, max));

  const goodCount = count - badCount;
  const good = GOOD_ROLE_POOL.slice(0, goodCount);
  const bad = BAD_ROLES.slice(0, badCount);
  return { good, bad, all: [...good, ...bad] };
}

export function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function getPhaseDuration(
  settings: RoomSettings,
  phase: GamePhase
): number {
  switch (phase) {
    case "deal":
      return settings.phaseTimers.deal;
    case "chat":
      return settings.phaseTimers.chat;
    case "results":
      return RESULTS_DURATION;
    default:
      return 0;
  }
}

export function getNextPhase(phase: GamePhase): GamePhase {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx === -1 || idx === PHASE_ORDER.length - 1) return "results";
  return PHASE_ORDER[idx + 1];
}

export interface RoundScoreResult {
  scores: Record<string, number>;
  correct: boolean;
  caughtBadIds: string[];
  undetectedBadIds: string[];
  wrongIds: string[];
  badIds: string[];
}

/**
 * Free-for-all round scoring.
 * - Good roles keep their guaranteed points regardless of the Police outcome.
 * - Police scores 500 only if every Bad Chit is accused and no innocent is.
 * - Otherwise the 500 is split equally among every undetected Bad Chit.
 */
export function calculateRoundScores(
  players: Record<string, Player>,
  policeId: string | null,
  accusedIds: string[]
): RoundScoreResult {
  const active = Object.values(players).filter((p) => p.status !== "left");
  const scores: Record<string, number> = {};
  active.forEach((p) => {
    scores[p.id] = 0;
  });

  const badIds = active.filter((p) => isBadRole(p.role)).map((p) => p.id);

  active.forEach((p) => {
    if (p.id === policeId) return;
    if (isGoodRole(p.role)) scores[p.id] = GUARANTEED_POINTS[p.role];
  });

  const accusedSet = new Set(accusedIds);
  const caughtBadIds = badIds.filter((id) => accusedSet.has(id));
  const wrongIds = [...accusedSet].filter((id) => !badIds.includes(id));
  const undetectedBadIds = badIds.filter((id) => !accusedSet.has(id));

  const correct =
    !!policeId &&
    badIds.length > 0 &&
    caughtBadIds.length === badIds.length &&
    wrongIds.length === 0;

  if (policeId && scores[policeId] !== undefined) {
    if (correct) {
      scores[policeId] = 500;
    } else {
      scores[policeId] = 0;
      if (undetectedBadIds.length > 0) {
        const per = Math.floor(500 / undetectedBadIds.length);
        undetectedBadIds.forEach((id) => {
          scores[id] = per;
        });
      }
    }
  }

  return { scores, correct, caughtBadIds, undetectedBadIds, wrongIds, badIds };
}

export function formatSeconds(total: number): string {
  const safe = Math.max(0, Math.floor(total));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function makeId(prefix = "p"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
