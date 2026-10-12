"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { ref, set, get } from "firebase/database";
import { generateRoomCode, getBadChitRange, makeId } from "@/lib/gameLogic";

export function RoomLobby() {
  const router = useRouter();
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [badChitCount, setBadChitCount] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const badRange = getBadChitRange(maxPlayers);

  const createRoom = async () => {
    if (!playerName.trim()) {
      setError("Please enter your name");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const roomId = generateRoomCode();
      const playerId = makeId("p");
      const clampedMax = Math.max(4, Math.min(8, maxPlayers));
      const { min: minBad, max: maxBad } = getBadChitRange(clampedMax);
      const clampedBad = Math.max(minBad, Math.min(badChitCount, maxBad));
      await set(ref(db, `rooms/${roomId}`), {
        roomId,
        hostId: playerId,
        phase: "waiting",
        round: 1,
        createdAt: Date.now(),
        startedAt: null,
        endedAt: null,
        settings: {
          maxPlayers: clampedMax,
          badChitCount: clampedBad,
          roundCount: 5,
          phaseTimers: { deal: 30, chat: 180 },
        },
        players: {
          [playerId]: {
            id: playerId,
            name: playerName.trim(),
            isHost: true,
            isBot: false,
            role: null,
            status: "active",
            joinedAt: Date.now(),
          },
        },
        chat: {},
        ready: {},
        phaseStartTime: null,
        phaseDuration: null,
        policeId: null,
        badCount: 0,
        accused: {},
        accusationSubmitted: false,
        results: null,
        totalScores: {},
        history: {},
      });
      router.push(`/room/${roomId}?playerId=${playerId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async () => {
    const code = roomCode.trim().toUpperCase();
    if (!playerName.trim()) {
      setError("Please enter your name");
      return;
    }
    if (code.length !== 6) {
      setError("Please enter a valid 6-character room code");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const snapshot = await get(ref(db, `rooms/${code}`));
      if (!snapshot.exists()) {
        setError("Room not found");
        return;
      }
      const data = snapshot.val();
      const players = data.players ?? {};
      const activeCount = Object.values(players).filter(
        (p) => (p as { status?: string }).status !== "left"
      ).length;
      if (data.phase !== "waiting") {
        setError("That game has already started");
        return;
      }
      if (activeCount >= (data.settings?.maxPlayers ?? 6)) {
        setError("Room is full");
        return;
      }
      const requestedName = playerName.trim().toLowerCase();
      const nameTaken = Object.values(players).some((p) => {
        const player = p as { name?: string; status?: string };
        return (
          player.status !== "left" &&
          (player.name ?? "").trim().toLowerCase() === requestedName
        );
      });
      if (nameTaken) {
        setError(
          "That name is already taken in this room — please use a different name"
        );
        return;
      }
      const playerId = makeId("p");
      await set(ref(db, `rooms/${code}/players/${playerId}`), {
        id: playerId,
        name: playerName.trim(),
        isHost: false,
        isBot: false,
        role: null,
        status: "active",
        joinedAt: Date.now(),
      });
      router.push(`/room/${code}?playerId=${playerId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join room");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-6 shadow-xl backdrop-blur">
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-gray-300">
            Your Name
          </label>
          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Enter your name"
            maxLength={20}
            className="w-full rounded-lg border border-gray-600 bg-gray-700 px-4 py-3 text-white placeholder-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-700 bg-red-900/50 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-5">
            <h3 className="mb-4 text-xl font-semibold text-yellow-400">
              Create Room
            </h3>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Max Players (4-8)
              </label>
              <input
                type="number"
                min={4}
                max={8}
                value={maxPlayers}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  const range = getBadChitRange(value);
                  setMaxPlayers(value);
                  setBadChitCount((prev) =>
                    Math.max(range.min, Math.min(prev, range.max))
                  );
                }}
                className="w-full rounded-lg border border-gray-600 bg-gray-700 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Bad Chits ({badRange.min} - {badRange.max})
              </label>
              <input
                type="number"
                min={badRange.min}
                max={badRange.max}
                value={badChitCount}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setBadChitCount(
                    Math.max(badRange.min, Math.min(value, badRange.max))
                  );
                }}
                className="w-full rounded-lg border border-gray-600 bg-gray-700 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Every seat gets a real chit — no blanks. Babu and Police are
                always dealt; extra seats become Bad Chits.
              </p>
            </div>
            <button
              onClick={() => void createRoom()}
              disabled={loading}
              className="w-full rounded-lg bg-red-600 py-3 font-semibold text-white transition-colors hover:bg-red-700 disabled:bg-gray-600"
            >
              {loading ? "Creating…" : "Create Room"}
            </button>
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-5">
            <h3 className="mb-4 text-xl font-semibold text-yellow-400">
              Join Room
            </h3>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Room Code
              </label>
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={6}
                className="w-full rounded-lg border border-gray-600 bg-gray-700 px-4 py-2 uppercase text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <button
              onClick={() => void joinRoom()}
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-gray-600"
            >
              {loading ? "Joining…" : "Join Room"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
