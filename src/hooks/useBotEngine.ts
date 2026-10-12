"use client";

import { useEffect, useRef } from "react";
import { db } from "@/lib/firebase";
import {
  ref as dbRef,
  update,
  set,
  push,
} from "firebase/database";
import type {
  BotChatRequestBody,
  BotChatResponse,
  Player,
  RoomState,
} from "@/types/game";

interface UseBotEngineOptions {
  room: RoomState | null;
  roomId: string | undefined;
  enabled: boolean;
}

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

function activeBots(room: RoomState): Player[] {
  return Object.values(room.players ?? {}).filter(
    (p) => p.isBot && p.status !== "left"
  );
}

function toPayload(
  room: RoomState,
  bot: Player,
  action: BotChatRequestBody["action"],
  extra: Partial<BotChatRequestBody> = {}
): BotChatRequestBody {
  const messages = Object.values(room.chat ?? {})
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-10)
    .map((m) => ({
      playerId: m.playerId,
      playerName: m.playerName,
      message: m.message,
      isBot: m.isBot,
    }));

  return {
    action,
    roomId: room.roomId,
    botId: bot.id,
    botName: bot.name,
    botRole: bot.role,
    phase: room.phase,
    round: room.round,
    policeId: room.policeId,
    players: Object.values(room.players ?? {})
      .filter((p) => p.status !== "left")
      .map((p) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        isPolice: room.policeId === p.id,
      })),
    recentMessages: messages,
    ...extra,
  };
}

async function askBot(payload: BotChatRequestBody): Promise<BotChatResponse> {
  try {
    const res = await fetch("/api/bot/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return {};
    return (await res.json()) as BotChatResponse;
  } catch {
    return {};
  }
}

export function useBotEngine({ room, roomId, enabled }: UseBotEngineOptions) {
  const roomRef = useRef<RoomState | null>(room);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  const nextChatAt = useRef<Record<string, number>>({});
  const readyHandled = useRef<Set<string>>(new Set());
  const accuseHandled = useRef<Set<number>>(new Set());
  const chatAccuseAt = useRef<number>(0);
  const busy = useRef<Set<string>>(new Set());
  const lastPhase = useRef<string>("");

  useEffect(() => {
    if (!roomId || !enabled) return;

    const postChat = async (current: RoomState, bot: Player) => {
      busy.current.add(bot.id);
      try {
        const payload = toPayload(current, bot, "chat");
        const data = await askBot(payload);
        const message =
          typeof data.message === "string" && data.message.trim().length > 0
            ? data.message.trim()
            : "...";
        const chatRef = dbRef(db, `rooms/${roomId}/chat`);
        const newRef = push(chatRef);
        await set(newRef, {
          id: newRef.key,
          playerId: bot.id,
          playerName: bot.name,
          message,
          timestamp: Date.now(),
          isBot: true,
          phase: current.phase,
          round: current.round,
        });
      } finally {
        busy.current.delete(bot.id);
      }
    };

    const setBotReady = async (current: RoomState, bot: Player) => {
      const key = `${current.round}:${bot.id}`;
      if (readyHandled.current.has(key)) return;
      readyHandled.current.add(key);
      await set(dbRef(db, `rooms/${roomId}/ready/${bot.id}`), true);
    };

    const accuse = async (current: RoomState, bot: Player) => {
      busy.current.add(bot.id);
      try {
        const candidates = Object.values(current.players ?? {})
          .filter((p) => p.status !== "left" && p.id !== bot.id)
          .map((p) => p.id);
        const data = await askBot(
          toPayload(current, bot, "accuse", {
            candidates,
            accuseCount: current.badCount,
          })
        );
        const accusedIds = (data.accusedIds ?? [])
          .filter((id) => candidates.includes(id))
          .slice(0, current.badCount);
        const accused: Record<string, boolean> = {};
        accusedIds.forEach((id) => {
          accused[id] = true;
        });
        await update(dbRef(db, `rooms/${roomId}`), {
          accused,
          accusationSubmitted: true,
        });
      } finally {
        busy.current.delete(bot.id);
      }
    };

    const tick = () => {
      const current = roomRef.current;
      if (!current || !enabled) return;

      const phaseKey = `${current.phase}:${current.round}`;
      const now = Date.now();
      if (lastPhase.current !== phaseKey) {
        lastPhase.current = phaseKey;
        if (current.phase === "waiting") {
          readyHandled.current = new Set();
          accuseHandled.current = new Set();
          nextChatAt.current = {};
        }
        if (current.phase === "chat") {
          nextChatAt.current = {};
          chatAccuseAt.current = now + randomBetween(18000, 40000);
        }
      }

      const bots = activeBots(current);

      for (const bot of bots) {
        if (busy.current.has(bot.id)) continue;

        if (current.phase === "deal" && !current.ready?.[bot.id]) {
          void setBotReady(current, bot);
        }

        if (current.phase === "chat") {
          if (nextChatAt.current[bot.id] === undefined) {
            nextChatAt.current[bot.id] = now + randomBetween(3000, 9000);
          } else if (now >= nextChatAt.current[bot.id]) {
            nextChatAt.current[bot.id] = now + randomBetween(11000, 20000);
            void postChat(current, bot);
          }
        }

        if (
          current.phase === "chat" &&
          current.policeId === bot.id &&
          !current.accusationSubmitted &&
          !accuseHandled.current.has(current.round) &&
          now >= chatAccuseAt.current
        ) {
          accuseHandled.current.add(current.round);
          void accuse(current, bot);
        }
      }
    };

    tick();
    const interval = window.setInterval(tick, 1500);
    return () => window.clearInterval(interval);
  }, [roomId, enabled]);
}
