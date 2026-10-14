"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bot as BotIcon,
  Check,
  CheckCircle2,
  Crown,
  Link2,
  LogOut,
  Mic,
  MicOff,
  Play,
  Plus,
  RefreshCw,
  Shield,
  SkipForward,
  Timer,
  Trash2,
  Trophy,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  XCircle,
} from "lucide-react";
import { db, subscribeServerTimeOffset } from "@/lib/firebase";
import {
  getMutedSnapshot,
  playSound,
  setMuted,
  subscribeMuted,
  unlockAudio,
} from "@/lib/sound";
import {
  off,
  onValue,
  push,
  ref as dbRef,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "firebase/database";
import {
  PHASE_HINTS,
  PHASE_LABELS,
  ROLE_META,
  RESULTS_DURATION,
  calculateRoundScores,
  formatSeconds,
  getRoleDistribution,
  isBadRole,
  makeId,
  shuffle,
} from "@/lib/gameLogic";
import type {
  ChatMessage,
  Player,
  PlayerRole,
  RoomSettings,
  RoomState,
  RoundRecord,
} from "@/types/game";
import { ChatBox } from "./ChatBox";
import { PoliceConsole } from "./PoliceConsole";
import { Confetti, FlashOverlay } from "./Celebration";
import { SeatVideo } from "./SeatVideo";
import { useBotEngine } from "@/hooks/useBotEngine";
import { useRtc } from "@/hooks/useRtc";

const BOT_NAMES = [
  "Rahim",
  "Karim",
  "Nadia",
  "Sultana",
  "Jasim",
  "Mitu",
  "Rafiq",
  "Shila",
  "Babul",
  "Tania",
];

const CHAT_PHASES = ["chat"];

const HOST_LEASE_MS = 14000;
const HOST_LEASE_RENEW_MS = 5000;
const HOST_LEASE_CHECK_MS = 4000;

const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 6,
  badChitCount: 2,
  roundCount: 5,
  phaseTimers: { deal: 30, chat: 180 },
};

function normalizeRoom(raw: unknown): RoomState {
  const r = (raw ?? {}) as RoomState;
  const settings = (r.settings ?? {}) as Partial<RoomSettings>;
  return {
    ...r,
    settings: {
      maxPlayers: settings.maxPlayers ?? DEFAULT_SETTINGS.maxPlayers,
      badChitCount: settings.badChitCount ?? DEFAULT_SETTINGS.badChitCount,
      roundCount: settings.roundCount ?? DEFAULT_SETTINGS.roundCount,
      phaseTimers: {
        deal: settings.phaseTimers?.deal ?? DEFAULT_SETTINGS.phaseTimers.deal,
        chat: settings.phaseTimers?.chat ?? DEFAULT_SETTINGS.phaseTimers.chat,
      },
    },
    players: r.players ?? {},
    chat: r.chat ?? {},
    ready: r.ready ?? {},
    accused: r.accused ?? {},
    badCount: r.badCount ?? 0,
    totalScores: r.totalScores ?? {},
    history: r.history ?? {},
    hostLease: r.hostLease ?? null,
  };
}

function seatPlayers(players: Record<string, Player>): Player[] {
  return Object.values(players ?? {})
    .filter((p) => p.status !== "left")
    .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
}

export function GameBoard() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = typeof params?.id === "string" ? params.id : undefined;
  const queryPlayerId = searchParams.get("playerId") ?? undefined;

  const [room, setRoom] = useState<RoomState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverNow, setServerNow] = useState(() => Date.now());
  const playerId = queryPlayerId;
  const muted = useSyncExternalStore(
    subscribeMuted,
    getMutedSnapshot,
    () => false
  );
  const [copied, setCopied] = useState(false);

  const offsetRef = useRef(0);
  const advancedKeyRef = useRef<string>("");

  // Restore a player's seat from a previous visit (reconnect / refresh).
  useEffect(() => {
    if (queryPlayerId || !roomId) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(`cp_room_${roomId}`);
    } catch {
      stored = null;
    }
    if (stored) router.replace(`/room/${roomId}?playerId=${stored}`);
  }, [queryPlayerId, roomId, router]);

  useEffect(() => {
    if (!roomId || !playerId) return;
    try {
      window.localStorage.setItem(`cp_room_${roomId}`, playerId);
    } catch {
      /* ignore */
    }
  }, [roomId, playerId]);

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    return subscribeServerTimeOffset((offset) => {
      offsetRef.current = offset;
      setServerNow(Date.now() + offset);
    });
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setServerNow(Date.now() + offsetRef.current);
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!roomId) return;
    const roomRef = dbRef(db, `rooms/${roomId}`);
    const unsubscribe = onValue(
      roomRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setRoom(normalizeRoom(snapshot.val()));
        } else {
          setError("Room not found or has been closed");
        }
        setLoading(false);
      },
      () => {
        setError("Unable to reach the game server");
        setLoading(false);
      }
    );
    return () => {
      unsubscribe();
      off(roomRef);
    };
  }, [roomId]);

  const players = useMemo(() => seatPlayers(room?.players ?? {}), [room]);
  const currentPlayer = useMemo(
    () => players.find((p) => p.id === playerId) ?? null,
    [players, playerId]
  );
  const playerCount = players.length;
  const isHost =
    !!currentPlayer &&
    (currentPlayer.isHost || room?.hostId === currentPlayer.id);
  const role: PlayerRole | null = currentPlayer?.role ?? null;
  const isPolice = role === "Police" || room?.policeId === currentPlayer?.id;
  const policeName = room?.policeId
    ? players.find((p) => p.id === room.policeId)?.name ?? null
    : null;

  const chatMessages: ChatMessage[] = useMemo(
    () =>
      Object.values(room?.chat ?? {}).sort((a, b) => a.timestamp - b.timestamp),
    [room]
  );

  const timeLeft = useMemo(() => {
    if (!room?.phaseStartTime || !room.phaseDuration) return null;
    const elapsed = Math.floor((serverNow - room.phaseStartTime) / 1000);
    return Math.max(0, room.phaseDuration - elapsed);
  }, [room, serverNow]);

  useBotEngine({ room, roomId, enabled: isHost });

  // On-seat peer-to-peer video/audio. Only other humans are peers; bots have none.
  const humanPeerIds = useMemo(
    () =>
      players.filter((p) => !p.isBot && p.id !== playerId).map((p) => p.id),
    [players, playerId]
  );
  const rtc = useRtc({
    roomId,
    playerId,
    peerIds: humanPeerIds,
    enabled: !!roomId && !!playerId,
  });

  // Host lease — the host renews a lease so the room keeps moving even if the
  // original host closes their tab. A stale lease lets another player take over.
  const meId = currentPlayer?.id;
  useEffect(() => {
    if (!roomId || !meId || !isHost) return;
    const leaseRef = dbRef(db, `rooms/${roomId}/hostLease`);
    const renew = () => {
      void set(leaseRef, {
        ownerId: meId,
        expiresAt: Date.now() + offsetRef.current + HOST_LEASE_MS,
      });
    };
    renew();
    const iv = window.setInterval(renew, HOST_LEASE_RENEW_MS);
    return () => window.clearInterval(iv);
  }, [roomId, meId, isHost]);

  useEffect(() => {
    if (!roomId || !meId || isHost) return;
    const leaseRef = dbRef(db, `rooms/${roomId}/hostLease`);
    const tryClaim = () => {
      const lease = room?.hostLease;
      const now = Date.now() + offsetRef.current;
      // Only take over a lease that existed and has expired — never race the
      // host while the room is still starting up.
      if (!lease || lease.expiresAt > now) return;
      const previousHostId = room?.hostId;
      void runTransaction(leaseRef, (current) => {
        const value = current as { expiresAt?: number } | null;
        if (
          value &&
          typeof value.expiresAt === "number" &&
          value.expiresAt > Date.now() + offsetRef.current + 1500
        ) {
          return;
        }
        return {
          ownerId: meId,
          expiresAt: Date.now() + offsetRef.current + HOST_LEASE_MS,
        };
      }).then((result) => {
        if (!result.committed) return;
        const claim = result.snapshot.val() as { ownerId?: string } | null;
        if (claim?.ownerId !== meId) return;
        const patch: Record<string, unknown> = {
          hostId: meId,
          [`players/${meId}/isHost`]: true,
        };
        if (previousHostId && previousHostId !== meId) {
          patch[`players/${previousHostId}/isHost`] = false;
        }
        void update(dbRef(db, `rooms/${roomId}`), patch);
      });
    };
    const iv = window.setInterval(tryClaim, HOST_LEASE_CHECK_MS);
    return () => window.clearInterval(iv);
  }, [roomId, meId, isHost, room?.hostLease, room?.hostId]);

  const beginRound = useCallback(
    async (round: number, resetScores: boolean) => {
      if (!room || !roomId) return;
      const active = seatPlayers(room.players);
      const dist = getRoleDistribution(active.length, room.settings.badChitCount);
      const roles = shuffle(dist.all);
      const updates: Record<string, unknown> = {
        phase: "deal",
        round,
        phaseStartTime: serverTimestamp(),
        phaseDuration: room.settings.phaseTimers.deal,
        accused: {},
        accusationSubmitted: false,
        results: null,
        ready: {},
        chat: null,
        policeId: null,
        badCount: dist.bad.length,
      };
      if (resetScores) {
        updates.startedAt = serverTimestamp();
        updates.endedAt = null;
      }
      active.forEach((p, i) => {
        updates[`players/${p.id}/role`] = roles[i] ?? null;
        if (resetScores || room.totalScores?.[p.id] === undefined) {
          updates[`totalScores/${p.id}`] = 0;
        }
      });
      const policeIdx = roles.indexOf("Police");
      updates.policeId = policeIdx >= 0 ? active[policeIdx].id : null;
      await update(dbRef(db, `rooms/${roomId}`), updates);
    },
    [room, roomId]
  );

  const finalizeRound = useCallback(async () => {
    if (!room || !roomId) return;
    if (room.history?.[room.round]) return;
    const accusedIds = Object.entries(room.accused ?? {})
      .filter(([, value]) => value)
      .map(([id]) => id);
    const outcome = calculateRoundScores(
      room.players,
      room.policeId,
      accusedIds
    );
    const newTotals: Record<string, number> = { ...(room.totalScores ?? {}) };
    Object.entries(outcome.scores).forEach(([id, points]) => {
      newTotals[id] = (newTotals[id] ?? 0) + points;
    });
    const revealedRoles: Record<string, PlayerRole> = {};
    Object.values(room.players).forEach((p) => {
      if (p.role) revealedRoles[p.id] = p.role;
    });
    const record: RoundRecord = {
      round: room.round,
      policeId: room.policeId,
      accused: accusedIds,
      correct: outcome.correct,
      caughtBadIds: outcome.caughtBadIds,
      undetectedBadIds: outcome.undetectedBadIds,
      wrongIds: outcome.wrongIds,
      scores: outcome.scores,
      revealedRoles,
    };
    const isLast = room.round >= room.settings.roundCount;
    await update(dbRef(db, `rooms/${roomId}`), {
      results: outcome.scores,
      totalScores: newTotals,
      accusationSubmitted: true,
      [`history/${room.round}`]: record,
      phase: isLast ? "ended" : "results",
      phaseStartTime: serverTimestamp(),
      phaseDuration: RESULTS_DURATION,
      ...(isLast ? { endedAt: serverTimestamp() } : {}),
    });
  }, [room, roomId]);

  const advancePhase = useCallback(async () => {
    if (!room || !roomId) return;
    const key = `${room.phase}:${room.phaseStartTime}`;
    if (advancedKeyRef.current === key) return;
    advancedKeyRef.current = key;

    const base = { phaseStartTime: serverTimestamp() };

    switch (room.phase) {
      case "deal":
        await update(dbRef(db, `rooms/${roomId}`), {
          ...base,
          phase: "chat",
          phaseDuration: room.settings.phaseTimers.chat,
          chat: null,
        });
        break;
      case "chat":
        await finalizeRound();
        break;
      case "results":
        if (room.round < room.settings.roundCount) {
          await beginRound(room.round + 1, false);
        } else {
          await update(dbRef(db, `rooms/${roomId}`), {
            phase: "ended",
            endedAt: serverTimestamp(),
          });
        }
        break;
      default:
        break;
    }
  }, [room, roomId, beginRound, finalizeRound]);

  useEffect(() => {
    if (!isHost || !room || !room.phaseStartTime || !room.phaseDuration) return;
    if (room.phase === "waiting" || room.phase === "ended") return;
    const endAt = room.phaseStartTime + room.phaseDuration * 1000;
    if (serverNow >= endAt) void advancePhase();
  }, [serverNow, isHost, room, advancePhase]);

  useEffect(() => {
    if (!isHost || !room || room.phase !== "deal") return;
    const active = seatPlayers(room.players);
    if (active.length === 0) return;
    const allReady = active.every((p) => room.ready?.[p.id]);
    if (allReady) void advancePhase();
  }, [room, isHost, advancePhase]);

  useEffect(() => {
    if (!isHost || !room) return;
    if (room.phase === "chat" && room.accusationSubmitted) void advancePhase();
  }, [room, isHost, advancePhase]);

  const prevPhaseKeyRef = useRef<string>("");
  const lastWarnSecondRef = useRef<number | null>(null);
  const accLockRef = useRef(false);
  const chatCountRef = useRef(0);
  const lastMsgSoundRef = useRef(0);
  const endedSoundRef = useRef(false);

  // Phase transition sounds + celebration bursts.
  useEffect(() => {
    if (!room) return;
    const key = `${room.phase}:${room.round}`;
    if (prevPhaseKeyRef.current === key) return;
    prevPhaseKeyRef.current = key;

    if (room.phase === "deal") {
      playSound("deal");
      if (role) window.setTimeout(() => playSound("reveal"), 420);
    } else if (room.phase === "chat") {
      playSound("start");
      lastWarnSecondRef.current = null;
      accLockRef.current = false;
    } else if (room.phase === "results") {
      const correct = room.history?.[room.round]?.correct ?? false;
      playSound(correct ? "correct" : "wrong");
    }
  }, [room, role]);

  // Countdown ticks in the final 10 seconds.
  useEffect(() => {
    if (!room || room.phase === "waiting" || room.phase === "ended") return;
    if (timeLeft === null || timeLeft <= 0) return;
    if (timeLeft > 10) {
      lastWarnSecondRef.current = null;
      return;
    }
    if (lastWarnSecondRef.current === timeLeft) return;
    lastWarnSecondRef.current = timeLeft;
    if (timeLeft === 10) {
      playSound("warning");
    } else if (timeLeft <= 5) {
      playSound("tick");
    }
  }, [room, timeLeft]);

  // Police siren when an accusation is locked in.
  useEffect(() => {
    if (!room || room.phase !== "chat") return;
    if (room.accusationSubmitted && !accLockRef.current) {
      accLockRef.current = true;
      playSound("lock");
    }
  }, [room]);

  // Soft blip for incoming chat messages.
  useEffect(() => {
    const total = chatMessages.length;
    if (total <= chatCountRef.current) {
      chatCountRef.current = total;
      return;
    }
    chatCountRef.current = total;
    if (!room || room.phase !== "chat") return;
    const now = Date.now();
    if (now - lastMsgSoundRef.current < 700) return;
    lastMsgSoundRef.current = now;
    playSound("message");
  }, [chatMessages, room]);

  // Final win / lose sting.
  useEffect(() => {
    if (!room || room.phase !== "ended" || endedSoundRef.current) return;
    endedSoundRef.current = true;
    const champ = players
      .map((p) => ({ id: p.id, total: room.totalScores?.[p.id] ?? 0 }))
      .sort((a, b) => b.total - a.total)[0];
    playSound(champ?.id === playerId ? "win" : "lose");
  }, [room, players, playerId]);

  // Declarative celebration + flash overlays (pure — no state in effects).
  const celebration = useMemo(() => {
    if (!room) return null;
    if (room.phase === "results" && room.history?.[room.round]?.correct) {
      return { key: `res-${room.round}`, seed: room.round };
    }
    if (room.phase === "ended") {
      const champ = players
        .map((p) => ({ id: p.id, total: room.totalScores?.[p.id] ?? 0 }))
        .sort((a, b) => b.total - a.total)[0];
      if (champ?.id === playerId) {
        return { key: `win-${room.round}`, seed: room.round + 100 };
      }
    }
    return null;
  }, [room, players, playerId]);

  const flashDescriptor = useMemo(() => {
    if (!room) return null;
    if (room.phase === "chat" && room.accusationSubmitted) {
      return { tone: "alarm" as const, key: `lock-${room.round}` };
    }
    if (room.phase === "results") {
      const correct = room.history?.[room.round]?.correct ?? false;
      return {
        tone: correct ? ("good" as const) : ("bad" as const),
        key: `res-${room.round}`,
      };
    }
    if (
      (room.phase === "chat" || room.phase === "deal") &&
      timeLeft !== null &&
      timeLeft <= 10 &&
      timeLeft > 0
    ) {
      return { tone: "alarm" as const, key: `warn-${room.round}-${room.phase}` };
    }
    return null;
  }, [room, timeLeft]);

  const nextBotName = useCallback(() => {
    const used = new Set(players.map((p) => p.name));
    const free = BOT_NAMES.find((name) => !used.has(name));
    return free ?? `Bot ${playerCount + 1}`;
  }, [players, playerCount]);

  const addBot = useCallback(async () => {
    if (!room || !roomId || !isHost || room.phase !== "waiting") return;
    if (playerCount >= room.settings.maxPlayers) return;
    const botId = makeId("bot");
    await set(dbRef(db, `rooms/${roomId}/players/${botId}`), {
      id: botId,
      name: nextBotName(),
      isHost: false,
      isBot: true,
      role: null,
      status: "active",
      joinedAt: Date.now(),
    });
  }, [room, roomId, isHost, playerCount, nextBotName]);

  const removeBot = useCallback(
    async (botId: string) => {
      if (!roomId || !isHost) return;
      await remove(dbRef(db, `rooms/${roomId}/players/${botId}`));
    },
    [roomId, isHost]
  );

  const sendChat = useCallback(
    async (text: string) => {
      if (!room || !roomId || !currentPlayer) return;
      if (!CHAT_PHASES.includes(room.phase)) return;
      const chatRef = dbRef(db, `rooms/${roomId}/chat`);
      const newRef = push(chatRef);
      await set(newRef, {
        id: newRef.key,
        playerId: currentPlayer.id,
        playerName: currentPlayer.name,
        message: text,
        timestamp: Date.now(),
        isBot: false,
        phase: room.phase,
        round: room.round,
      });
    },
    [room, roomId, currentPlayer]
  );

  const toggleReady = useCallback(async () => {
    if (!room || !roomId || !currentPlayer) return;
    if (room.phase !== "deal") return;
    const readyRef = dbRef(db, `rooms/${roomId}/ready/${currentPlayer.id}`);
    const next = !room.ready?.[currentPlayer.id];
    if (next) {
      await set(readyRef, true);
    } else {
      await remove(readyRef);
    }
  }, [room, roomId, currentPlayer]);

  const toggleAccused = useCallback(
    async (targetId: string) => {
      if (!room || !roomId || !isPolice) return;
      if (room.phase !== "chat" || room.accusationSubmitted) return;
      const limit = room.badCount;
      const accusedRef = dbRef(db, `rooms/${roomId}/accused`);
      await runTransaction(accusedRef, (current: Record<string, boolean> | null) => {
        const next = { ...(current ?? {}) };
        if (next[targetId]) {
          delete next[targetId];
        } else {
          const ticked = Object.values(next).filter(Boolean).length;
          if (ticked >= limit) return next;
          next[targetId] = true;
        }
        return next;
      });
    },
    [room, roomId, isPolice]
  );

  const submitAccusation = useCallback(async () => {
    if (!room || !roomId || !isPolice) return;
    if (room.phase !== "chat" || room.accusationSubmitted) return;
    const ticked = Object.values(room.accused ?? {}).filter(Boolean).length;
    if (ticked !== room.badCount) return;
    await update(dbRef(db, `rooms/${roomId}`), {
      accusationSubmitted: true,
    });
  }, [room, roomId, isPolice]);

  const playAgain = useCallback(async () => {
    if (!room || !roomId || !isHost) return;
    await update(dbRef(db, `rooms/${roomId}`), {
      phase: "waiting",
      round: 1,
      startedAt: null,
      endedAt: null,
      phaseStartTime: null,
      phaseDuration: null,
      policeId: null,
      badCount: 0,
      accused: null,
      accusationSubmitted: false,
      results: null,
      totalScores: null,
      history: null,
      chat: null,
      ready: null,
    });
    const active = seatPlayers(room.players);
    const roleResets: Record<string, null> = {};
    active.forEach((p) => {
      roleResets[`players/${p.id}/role`] = null;
    });
    await update(dbRef(db, `rooms/${roomId}`), roleResets);
  }, [room, roomId, isHost]);

  const leaveRoom = useCallback(async () => {
    if (!room || !roomId || !currentPlayer) {
      router.push("/");
      return;
    }
    const remaining = players.filter((p) => p.id !== currentPlayer.id);
    const remainingHumans = remaining.filter((p) => !p.isBot);

    // No other human is left (nobody, or only bots) — tear the room down.
    if (remainingHumans.length === 0) {
      await remove(dbRef(db, `rooms/${roomId}`));
      try {
        window.localStorage.removeItem(`cp_room_${roomId}`);
      } catch {
        /* ignore */
      }
      router.push("/");
      return;
    }

    const updates: Record<string, unknown> = {
      [`players/${currentPlayer.id}/status`]: "left",
      [`players/${currentPlayer.id}/isHost`]: false,
    };
    if (isHost) {
      const heir = remainingHumans[0] ?? remaining[0];
      updates.hostId = heir.id;
      updates[`players/${heir.id}/isHost`] = true;
    }
    await update(dbRef(db, `rooms/${roomId}`), updates);
    try {
      window.localStorage.removeItem(`cp_room_${roomId}`);
    } catch {
      /* ignore */
    }
    router.push("/");
  }, [room, roomId, currentPlayer, players, router, isHost]);

  const toggleMute = useCallback(() => {
    const next = !getMutedSnapshot();
    setMuted(next);
    if (!next) {
      unlockAudio();
      playSound("join");
    }
  }, []);

  const copyInvite = useCallback(async () => {
    if (!roomId) return;
    const url = `${window.location.origin}/?room=${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard unavailable */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, [roomId]);

  if (!roomId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900 p-4">
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-6 text-center">
          <p className="mb-4 text-red-400">No room specified.</p>
          <button
            onClick={() => router.push("/")}
            className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
        Loading the syndicate…
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900 p-4">
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-6 text-center">
          <p className="mb-4 text-red-400">{error ?? "Room not found"}</p>
          <button
            onClick={() => router.push("/")}
            className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  const meta = role ? ROLE_META[role] : null;
  const canChat = CHAT_PHASES.includes(room.phase);
  const revealAll = room.phase === "results" || room.phase === "ended";
  const rawRecord = room.history?.[room.round];
  const roundRecord: RoundRecord | null = rawRecord
    ? {
        ...rawRecord,
        accused: rawRecord.accused ?? [],
        caughtBadIds: rawRecord.caughtBadIds ?? [],
        undetectedBadIds: rawRecord.undetectedBadIds ?? [],
        wrongIds: rawRecord.wrongIds ?? [],
        scores: rawRecord.scores ?? {},
        revealedRoles: rawRecord.revealedRoles ?? {},
      }
    : null;
  const leaderboard = players
    .map((p) => ({ ...p, total: room.totalScores?.[p.id] ?? 0 }))
    .sort((a, b) => b.total - a.total);

  const readyCount = players.filter((p) => room.ready?.[p.id]).length;
  const iAmReady = !!currentPlayer && !!room.ready?.[currentPlayer.id];

  const liveAccusedNames = Object.entries(room.accused ?? {})
    .filter(([, v]) => v)
    .map(([id]) => players.find((p) => p.id === id)?.name)
    .filter((name): name is string => !!name);

  const verdict = revealAll && roundRecord ? roundRecord.correct : null;

  const banner = (() => {
    switch (room.phase) {
      case "waiting":
        return {
          emoji: "🕹️",
          title: "Lobby",
          detail: `Waiting for the host to start. ${playerCount}/${room.settings.maxPlayers} players seated.`,
          cls: "border-gray-700 bg-gray-800/50 text-gray-300",
        };
      case "deal":
        return {
          emoji: "🃏",
          title: policeName ? `Police revealed: ${policeName}` : "Dealing chits",
          detail:
            "Every chit is face-down except your own. Only the Police is public knowledge.",
          cls: "border-blue-500/40 bg-blue-950/30 text-blue-200",
        };
      case "chat": {
        const ticked =
          liveAccusedNames.length > 0
            ? ` Suspects ticked live: ${liveAccusedNames.join(", ")}.`
            : "";
        return {
          emoji: "💬",
          title: policeName
            ? `Interrogation — Police ${policeName} can accuse any time`
            : "Interrogation",
          detail: `Live chat is open. Innocents defend, Bad Chits bluff, the Police probes — and may lock an accusation whenever ready.${ticked}`,
          cls: "border-sky-500/40 bg-sky-950/30 text-sky-200",
        };
      }
      case "results": {
        const ok = verdict === true;
        return {
          emoji: ok ? "✅" : "❌",
          title: ok
            ? "Correct! Every Bad Chit was caught."
            : "Failed! Bad Chits slipped past the Police.",
          detail:
            "Round payout is in. Follow the payout panel below for who earned what.",
          cls: ok
            ? "border-green-500/40 bg-green-950/30 text-green-200"
            : "border-red-500/40 bg-red-950/30 text-red-200",
        };
      }
      case "ended":
        return {
          emoji: "🏁",
          title: "Game over",
          detail: "All rounds complete. Final leaderboard below.",
          cls: "border-gray-600 bg-gray-800/60 text-gray-200",
        };
      default:
        return {
          emoji: "🎮",
          title: room.phase,
          detail: PHASE_HINTS[room.phase],
          cls: "border-gray-700 bg-gray-800/50 text-gray-300",
        };
    }
  })();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-3 text-white md:p-4">
      {flashDescriptor && (
        <FlashOverlay tone={flashDescriptor.tone} trigger={flashDescriptor.key} />
      )}
      {celebration && <Confetti key={celebration.key} seed={celebration.seed} />}
      <div className="mx-auto max-w-7xl">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-red-500 md:text-3xl">
              CHOR POLICE
            </h1>
            <p className="text-sm text-gray-400">
              Room <span className="font-mono text-yellow-400">{roomId}</span> ·
              Round {room.round}/{room.settings.roundCount} · {playerCount}{" "}
              players · Phase {PHASE_LABELS[room.phase]}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {timeLeft !== null && (
              <div
                className={`flex items-center gap-2 rounded-lg border bg-gray-800 px-4 py-2 ${
                  timeLeft <= 10 && room.phase !== "ended"
                    ? "animate-danger border-red-500/60"
                    : "border-gray-700"
                }`}
              >
                <Timer
                  className={`h-5 w-5 ${
                    timeLeft <= 10 && room.phase !== "ended"
                      ? "text-red-400"
                      : "text-yellow-400"
                  }`}
                />
                <span
                  className={`text-xl font-bold ${
                    timeLeft <= 10 && room.phase !== "ended"
                      ? "text-red-400"
                      : "text-yellow-400"
                  }`}
                >
                  {formatSeconds(timeLeft)}
                </span>
              </div>
            )}
            <button
              onClick={() => rtc.setMic(!rtc.micOn)}
              title={rtc.micOn ? "Mute microphone" : "Unmute microphone"}
              className={`rounded-lg border p-2 ${
                rtc.micOn
                  ? "border-emerald-500/60 bg-emerald-900/40 text-emerald-300 hover:bg-emerald-800/40"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {rtc.micOn ? (
                <Mic className="h-4 w-4" />
              ) : (
                <MicOff className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => rtc.setCam(!rtc.camOn)}
              title={rtc.camOn ? "Turn camera off" : "Turn camera on"}
              className={`rounded-lg border p-2 ${
                rtc.camOn
                  ? "border-emerald-500/60 bg-emerald-900/40 text-emerald-300 hover:bg-emerald-800/40"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {rtc.camOn ? (
                <Video className="h-4 w-4" />
              ) : (
                <VideoOff className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => void copyInvite()}
              title="Copy invite link"
              className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700"
            >
              <Link2 className="h-4 w-4" />
              <span className="hidden sm:inline">
                {copied ? "Copied!" : "Invite"}
              </span>
            </button>
            <button
              onClick={toggleMute}
              title={muted ? "Unmute" : "Mute"}
              className="rounded-lg border border-gray-700 bg-gray-800 p-2 text-gray-300 hover:bg-gray-700"
            >
              {muted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => void leaveRoom()}
              title="Leave room"
              className="rounded-lg border border-gray-700 bg-gray-800 p-2 text-gray-300 hover:bg-gray-700"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {rtc.error && (
          <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            {rtc.error}
          </p>
        )}

        <div
          className={`mb-4 flex flex-col gap-1 rounded-xl border px-4 py-3 ${banner.cls}`}
        >
          <p className="flex items-center gap-2 text-sm font-semibold md:text-base">
            <span className="text-xl">{banner.emoji}</span>
            {banner.title}
          </p>
          <p className="text-xs opacity-80 md:text-sm">{banner.detail}</p>
        </div>

        {meta && (
          <div
            key={`${room.round}-${role}`}
            className={`animate-flip mb-4 rounded-2xl border-2 p-4 md:p-5 ${meta.accent}`}
          >
            <div className="flex items-center gap-4">
              <span className="shrink-0 text-4xl md:text-5xl">{meta.emoji}</span>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-widest opacity-70">
                  Your secret chit
                </p>
                <p className="text-2xl font-bold md:text-3xl">{meta.label}</p>
                <p className="break-words text-sm opacity-80">{meta.blurb}</p>
              </div>
            </div>
            <p className="mt-3 text-xs font-medium opacity-90 md:text-sm">
              {role === "Police"
                ? "Everyone at the table can see you are the Police."
                : isBadRole(role)
                  ? "You are a Bad Chit — stay undetected or blend in with the crowd."
                  : "Only you can see this chit. Protect it."}
            </p>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-2xl border border-gray-700 bg-gray-800/40 p-2 sm:p-4">
              <div className="relative mx-auto aspect-square w-full max-w-[460px]">
                <div
                  className={`absolute left-1/2 top-1/2 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border text-center md:h-36 md:w-36 ${
                    verdict === true
                      ? "border-green-500/50 bg-green-950/60"
                      : verdict === false
                        ? "border-red-500/50 bg-red-950/60"
                        : "border-gray-700 bg-gray-900/80"
                  }`}
                >
                  <span className="text-xs uppercase tracking-widest text-gray-500">
                    {room.phase === "waiting"
                      ? "Lobby"
                      : revealAll
                        ? verdict === true
                          ? "Caught all"
                          : "Failed"
                        : PHASE_LABELS[room.phase]}
                  </span>
                  {timeLeft !== null ? (
                    <span className="text-3xl font-bold text-yellow-400 md:text-4xl">
                      {formatSeconds(timeLeft)}
                    </span>
                  ) : (
                    <span className="text-xl font-bold text-yellow-400 md:text-2xl">
                      R{room.round}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">
                    {revealAll
                      ? roundRecord
                        ? roundRecord.correct
                          ? "Police +500"
                          : "500 split"
                        : ""
                      : `Next: ${
                          room.phase === "ended" || room.phase === "waiting"
                            ? "—"
                            : PHASE_LABELS[
                                room.phase === "deal"
                                  ? "chat"
                                  : room.phase === "chat"
                                    ? "results"
                                    : "deal"
                              ]
                        }`}
                  </span>
                </div>

                {players.map((p, i) => {
                  const angle =
                    (-90 + (360 / playerCount) * i) * (Math.PI / 180);
                  const x = 50 + 36 * Math.cos(angle);
                  const y = 50 + 36 * Math.sin(angle);
                  const showRole = p.id === playerId || revealAll;
                  const roleMeta =
                    showRole && p.role ? ROLE_META[p.role] : null;
                  const policeSeat = room.policeId === p.id;
                  const seatReady = room.phase === "deal" && !!room.ready?.[p.id];
                  const isAccused = room.phase === "chat" && !!room.accused?.[p.id];
                  const isSelf = p.id === playerId;
                  const seatStream = isSelf
                    ? rtc.localStream
                    : rtc.remoteStreams[p.id] ?? null;
                  const hasVideo =
                    !!seatStream && seatStream.getVideoTracks().length > 0;
                  return (
                    <div
                      key={p.id}
                      style={{ left: `${x}%`, top: `${y}%` }}
                      className="absolute w-[68px] -translate-x-1/2 -translate-y-1/2 sm:w-24 md:w-28"
                    >
                      <div
                        className={`flex flex-col items-center rounded-xl border border-gray-700 bg-gray-900/95 p-1.5 text-center shadow-lg sm:p-2 ${
                          p.id === playerId
                            ? "ring-2 ring-red-500/80"
                            : isAccused
                              ? "animate-ring ring-2 ring-red-500/80"
                              : policeSeat
                                ? "animate-glow-blue ring-2 ring-blue-400/80"
                                : ""
                        }`}
                      >
                        <div className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-gray-700 text-base sm:h-9 sm:w-9 sm:text-lg md:h-10 md:w-10 md:text-xl">
                          {seatStream && (
                            <SeatVideo
                              stream={seatStream}
                              muted={isSelf}
                              className={`absolute inset-0 h-full w-full object-cover ${
                                hasVideo ? "" : "opacity-0"
                              }`}
                            />
                          )}
                          {!hasVideo &&
                            (roleMeta ? (
                              roleMeta.emoji
                            ) : policeSeat ? (
                              <Shield className="h-5 w-5 text-blue-400" />
                            ) : (
                              p.name.charAt(0).toUpperCase()
                            ))}
                        </div>
                        <span className="mt-1 max-w-full truncate text-xs font-semibold text-gray-100">
                          {p.name}
                        </span>
                        <div className="mt-0.5 flex items-center gap-1 text-[10px]">
                          {p.isHost && <Crown className="h-3 w-3 text-yellow-400" />}
                          {p.isBot && (
                            <BotIcon className="h-3 w-3 text-purple-400" />
                          )}
                          {roleMeta && (
                            <span className="font-medium text-gray-300">
                              {p.role}
                            </span>
                          )}
                        </div>
                        {policeSeat && !roleMeta && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-blue-300">
                            POLICE
                          </span>
                        )}
                        {revealAll && roundRecord?.scores?.[p.id] !== undefined && (
                          <span className="text-[10px] font-semibold text-emerald-400">
                            +{roundRecord.scores[p.id]}
                          </span>
                        )}
                        {p.id === playerId && (
                          <span className="text-[9px] font-bold text-red-400">
                            YOU
                          </span>
                        )}
                        {seatReady && (
                          <span className="mt-0.5 flex items-center gap-1 text-[9px] font-semibold text-green-400">
                            <Check className="h-3 w-3" /> ready
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {room.phase === "waiting" && (
              <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-5">
                <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-yellow-400">
                  <Users className="h-5 w-5" />
                  Lobby · {playerCount}/{room.settings.maxPlayers}
                </h2>
                {!isHost && (
                  <p className="mb-3 text-sm text-gray-400">
                    {playerCount < 4
                      ? "The game starts when there are at least 4 players and "
                      : "Waiting for "}
                    the host to press start — tell everyone to join.
                  </p>
                )}
                <div className="space-y-2">
                  {players.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-lg bg-gray-900/60 p-3"
                    >
                      <span className="flex items-center gap-2 text-sm">
                        {p.isHost && (
                          <Crown className="h-4 w-4 text-yellow-400" />
                        )}
                        {p.name} {p.id === playerId && "(you)"}
                        {p.isBot && (
                          <span className="rounded bg-purple-700 px-2 py-0.5 text-[10px]">
                            BOT
                          </span>
                        )}
                      </span>
                      {isHost && p.isBot && (
                        <button
                          onClick={() => void removeBot(p.id)}
                          className="text-gray-500 hover:text-red-400"
                          title="Remove bot"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {isHost ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      onClick={() => void addBot()}
                      disabled={playerCount >= room.settings.maxPlayers}
                      className="flex items-center gap-1 rounded-lg bg-purple-600 px-4 py-2 font-medium hover:bg-purple-700 disabled:bg-gray-600"
                    >
                      <Plus className="h-4 w-4" />
                      Add Bot
                    </button>
                    <button
                      onClick={() => void beginRound(1, true)}
                      disabled={playerCount < 4}
                      className="flex items-center gap-1 rounded-lg bg-green-600 px-6 py-2 font-semibold hover:bg-green-700 disabled:bg-gray-600"
                    >
                      <Play className="h-4 w-4" />
                      {playerCount < 4 ? "Need 4+ players" : "Start Game"}
                    </button>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-gray-400">
                    Waiting for the host to start the game…
                  </p>
                )}
              </div>
            )}

            {room.phase === "deal" && (
              <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-5 text-sm text-blue-100">
                <p className="font-semibold">
                  🃏 Your chit is shown at the top — memorise it.
                </p>
                <p className="mt-1 text-xs opacity-80">
                  The Police is {policeName ?? "unknown"} and that is public.
                  Everyone else&apos;s chit stays hidden until the payout.
                </p>

                <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-900/20 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-200">
                    Seen your chit? Tick to continue ({readyCount}/{playerCount})
                  </p>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-gray-900/60 p-3">
                    <input
                      type="checkbox"
                      checked={iAmReady}
                      onChange={() => void toggleReady()}
                      className="h-5 w-5 accent-green-500"
                    />
                    <span className="text-sm text-white">
                      I&apos;ve seen my chit — ready for the interrogation
                    </span>
                  </label>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {players.map((p) => (
                      <span
                        key={p.id}
                        className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                          room.ready?.[p.id]
                            ? "bg-green-900/60 text-green-200"
                            : "bg-gray-800 text-gray-400"
                        }`}
                      >
                        {room.ready?.[p.id] && <Check className="h-3 w-3" />}
                        {p.name}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs opacity-70">
                    The round begins the moment everyone is ready.
                  </p>
                </div>
              </div>
            )}

            {room.phase === "chat" && (
              <PoliceConsole
                players={players}
                currentPlayerId={playerId}
                isPolice={isPolice}
                policeName={policeName ?? undefined}
                accused={room.accused ?? {}}
                maxAccusations={room.badCount}
                submitted={!!room.accusationSubmitted}
                disabled={!isPolice}
                onToggle={(id) => void toggleAccused(id)}
                onSubmit={() => void submitAccusation()}
              />
            )}

            {revealAll && roundRecord && (
              <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-5">
                <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-yellow-400">
                  {roundRecord.correct ? (
                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-400" />
                  )}
                  Round {roundRecord.round} — Payout
                </h2>

                <div
                  className={`mb-4 rounded-lg border p-3 text-sm font-semibold ${
                    roundRecord.correct
                      ? "border-green-500/40 bg-green-950/40 text-green-200"
                      : "border-red-500/40 bg-red-950/40 text-red-200"
                  }`}
                >
                  {roundRecord.correct
                    ? "✅ Correct — Police caught every Bad Chit and earns 500."
                    : "❌ Failed — Police named the wrong people, 500 splits among the undetected."}
                </div>

                <div className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div className="rounded-lg bg-gray-900/60 p-3">
                    <p className="mb-1 text-xs font-semibold text-gray-400">
                      Police accused
                    </p>
                    {roundRecord.accused.length > 0 ? (
                      <p className="text-gray-200">
                        {roundRecord.accused
                          .map((id) => players.find((p) => p.id === id)?.name)
                          .join(", ")}
                      </p>
                    ) : (
                      <p className="text-gray-500">Nobody (a forfeit)</p>
                    )}
                  </div>
                  <div className="rounded-lg bg-gray-900/60 p-3">
                    <p className="mb-1 text-xs font-semibold text-gray-400">
                      Bad Chits at the table
                    </p>
                    <p className="text-gray-200">
                      {roundRecord.caughtBadIds.length + roundRecord.undetectedBadIds.length > 0
                        ? [...roundRecord.caughtBadIds, ...roundRecord.undetectedBadIds]
                            .map((id) => players.find((p) => p.id === id)?.name)
                            .join(", ")
                        : "None"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-gray-900/60 p-3">
                    <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-400">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                      Caught
                    </p>
                    {roundRecord.caughtBadIds.length > 0 ? (
                      <p className="text-green-200">
                        {roundRecord.caughtBadIds
                          .map((id) => players.find((p) => p.id === id)?.name)
                          .join(", ")}
                      </p>
                    ) : (
                      <p className="text-gray-500">None</p>
                    )}
                  </div>
                  <div className="rounded-lg bg-gray-900/60 p-3">
                    <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-400">
                      <XCircle className="h-3.5 w-3.5 text-red-400" />
                      Missed (undetected)
                    </p>
                    {roundRecord.undetectedBadIds.length > 0 ? (
                      <p className="text-red-200">
                        {roundRecord.undetectedBadIds
                          .map((id) => players.find((p) => p.id === id)?.name)
                          .join(", ")}
                      </p>
                    ) : (
                      <p className="text-gray-500">None</p>
                    )}
                  </div>
                  {roundRecord.wrongIds.length > 0 && (
                    <div className="rounded-lg bg-gray-900/60 p-3 sm:col-span-2">
                      <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-400">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                        Wrongly accused innocents
                      </p>
                      <p className="text-amber-200">
                        {roundRecord.wrongIds
                          .map((id) => players.find((p) => p.id === id)?.name)
                          .join(", ")}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {players.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-lg bg-gray-900/60 p-2.5 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        {roundRecord.revealedRoles[p.id]
                          ? ROLE_META[roundRecord.revealedRoles[p.id]].emoji
                          : "❔"}{" "}
                        {p.name}
                        <span className="text-xs text-gray-500">
                          {roundRecord.revealedRoles[p.id]}
                        </span>
                        {p.id === playerId && (
                          <span className="text-[10px] font-bold text-red-400">
                            YOU
                          </span>
                        )}
                      </span>
                      <span className="font-semibold text-emerald-400">
                        +{roundRecord.scores[p.id] ?? 0}
                      </span>
                    </div>
                  ))}
                </div>

                {isHost && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      onClick={() => void advancePhase()}
                      className="flex items-center gap-1 rounded-lg bg-green-600 px-4 py-2 font-semibold hover:bg-green-700"
                    >
                      <SkipForward className="h-4 w-4" />
                      {room.phase === "ended"
                        ? "Back to lobby"
                        : room.round >= room.settings.roundCount
                          ? "Finish game"
                          : "Next round"}
                    </button>
                    {room.phase === "ended" && (
                      <button
                        onClick={() => void playAgain()}
                        className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 font-semibold hover:bg-blue-700"
                      >
                        <RefreshCw className="h-4 w-4" /> Play again
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {room.phase === "ended" && !roundRecord && (
              <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-5 text-sm text-gray-400">
                Game over — no results to show.
              </div>
            )}

            {isHost &&
              room.phase !== "waiting" &&
              room.phase !== "ended" &&
              room.phase !== "results" && (
                <button
                  onClick={() => void advancePhase()}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300"
                >
                  <SkipForward className="h-3 w-3" />
                  Host: skip to next phase
                </button>
              )}
          </div>

          <div className="space-y-6">
            <div className="h-[420px]">
              <ChatBox
                messages={chatMessages}
                currentPlayerId={playerId}
                disabled={!canChat}
                onSend={sendChat}
              />
            </div>

            <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
              <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-yellow-400">
                <Trophy className="h-5 w-5" />
                Leaderboard
              </h2>
              {room.phase === "ended" && leaderboard[0] && (
                <p className="mb-3 text-xs text-gray-400">
                  Champion:{" "}
                  <span className="font-semibold text-yellow-300">
                    {leaderboard[0].name}
                  </span>{" "}
                  with {leaderboard[0].total} points.
                </p>
              )}
              <div className="space-y-2">
                {leaderboard.map((p, i) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between rounded-lg p-2.5 text-sm ${
                      p.id === playerId
                        ? "bg-red-900/30 ring-1 ring-red-500/50"
                        : "bg-gray-900/60"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-5 text-gray-500">#{i + 1}</span>
                      {p.name}
                      {p.id === playerId && (
                        <span className="text-[10px] font-bold text-red-400">
                          YOU
                        </span>
                      )}
                      {p.isBot && (
                        <BotIcon className="h-3 w-3 text-purple-400" />
                      )}
                    </span>
                    <span className="font-semibold text-yellow-400">
                      {p.total}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
