"use client";

import {
  CheckCircle2,
  Lock,
  Shield,
  ShieldAlert,
  UserX,
} from "lucide-react";
import type { Player } from "@/types/game";

interface PoliceConsoleProps {
  players: Player[];
  currentPlayerId?: string;
  isPolice: boolean;
  policeName?: string;
  accused: Record<string, boolean>;
  maxAccusations: number;
  submitted: boolean;
  disabled?: boolean;
  onToggle: (playerId: string) => void;
  onSubmit: () => void;
}

export function PoliceConsole({
  players,
  currentPlayerId,
  isPolice,
  policeName,
  accused,
  maxAccusations,
  submitted,
  disabled,
  onToggle,
  onSubmit,
}: PoliceConsoleProps) {
  const suspects = players.filter(
    (p) => p.status !== "left" && p.id !== currentPlayerId
  );
  const accusedNames = suspects
    .filter((p) => accused[p.id])
    .map((p) => p.name);
  const tickedCount = accusedNames.length;
  const atLimit = tickedCount >= maxAccusations;
  const readyToLock = tickedCount === maxAccusations;

  const summary = (
    <div className="mt-3 space-y-2">
      <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3 text-sm">
        <p className="mb-1 flex items-center gap-1.5 text-gray-400">
          <ShieldAlert className="h-3.5 w-3.5" />
          Live accusations
          {isPolice && !submitted && (
            <span className="text-gray-600">(only you can edit)</span>
          )}
        </p>
        {accusedNames.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {accusedNames.map((name) => (
              <span
                key={name}
                className="rounded bg-red-900/60 px-2 py-0.5 text-xs font-medium text-red-200"
              >
                {name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">
            {submitted
              ? "The accusation was lodged with no suspects."
              : "No suspects ticked yet."}
          </p>
        )}
      </div>
      <div
        className={`rounded-lg border p-3 text-sm ${
          submitted
            ? "border-green-500/40 bg-green-900/20 text-green-300"
            : "border-gray-700 bg-gray-900/50 text-gray-400"
        }`}
      >
        Accusation status:{" "}
        {submitted ? (
          <span className="font-semibold">Lodged — verdict pending</span>
        ) : (
          <span className="text-yellow-400">Open — lock any time</span>
        )}
      </div>
    </div>
  );

  if (!isPolice) {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-blue-300">
          <Shield className="h-5 w-5" />
          Police Console
          {policeName && (
            <span className="ml-1 rounded bg-blue-600/30 px-2 py-0.5 text-xs font-bold text-blue-200">
              {policeName}
            </span>
          )}
        </h2>
        <p className="text-sm text-gray-400">
          Only the Police can lodge accusations. The Police may lock a verdict at
          any moment during the discussion — watch the live ticks below, every
          tick is a suspect the Police names to the room.
        </p>
        {summary}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-blue-500/40 bg-blue-950/30 p-4">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-blue-300">
        <ShieldAlert className="h-5 w-5" />
        Police Console · You are the Police
      </h2>
      <p className="mb-3 text-xs text-gray-400">
        Exactly {maxAccusations} Bad Chit{maxAccusations === 1 ? "" : "s"} are at
        this table. Tick exactly {maxAccusations} suspect
        {maxAccusations === 1 ? "" : "s"}, then lock.
      </p>

      <div className="space-y-2">
        {suspects.map((p) => {
          const checked = !!accused[p.id];
          const locked = submitted || disabled || (atLimit && !checked);
          return (
            <label
              key={p.id}
              className={`flex cursor-pointer items-center justify-between rounded-lg border p-2.5 transition-colors ${
                checked
                  ? "border-red-500/60 bg-red-900/30"
                  : "border-gray-700 bg-gray-900/50 hover:border-gray-500"
              } ${locked ? "cursor-not-allowed opacity-70" : ""}`}
            >
              <span className="flex items-center gap-2 text-sm text-white">
                {p.name}
                {p.isBot && (
                  <span className="rounded bg-purple-700 px-1.5 py-0.5 text-[10px]">
                    BOT
                  </span>
                )}
              </span>
              <input
                type="checkbox"
                checked={checked}
                disabled={locked}
                onChange={() => onToggle(p.id)}
                className="h-5 w-5 accent-red-600"
              />
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-gray-400">
          {tickedCount}/{maxAccusations} suspect
          {maxAccusations === 1 ? "" : "s"} ticked
        </span>
        {submitted ? (
          <span className="flex items-center gap-1 rounded-lg bg-green-900/40 px-3 py-2 text-sm font-medium text-green-300">
            <CheckCircle2 className="h-4 w-4" />
            Lodged
          </span>
        ) : (
          <button
            onClick={onSubmit}
            disabled={disabled || !readyToLock}
            className="flex items-center gap-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-600"
          >
            <Lock className="h-4 w-4" />
            Lock Accusation
          </button>
        )}
      </div>

      {tickedCount > 0 && <div className="mt-3">{summary}</div>}

      {!readyToLock && !submitted && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
          <UserX className="h-3.5 w-3.5" />
          {tickedCount < maxAccusations
            ? `Tick ${maxAccusations - tickedCount} more to lock.`
            : "Too many suspects ticked."}
        </p>
      )}
    </div>
  );
}