"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import type { ChatMessage } from "@/types/game";

interface ChatBoxProps {
  messages: ChatMessage[];
  currentPlayerId?: string;
  disabled?: boolean;
  onSend: (text: string) => void | Promise<void>;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ChatBox({
  messages,
  currentPlayerId,
  disabled,
  onSend,
}: ChatBoxProps) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft("");
    await onSend(text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-gray-700 bg-gray-800/50 p-4">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-yellow-400">
        <MessageSquare className="h-5 w-5" />
        Interrogation
      </h2>

      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto pr-1 text-sm"
      >
        {messages.length === 0 && (
          <p className="italic text-gray-500">No messages yet. Start probing…</p>
        )}
        {messages.map((m) => {
          const mine = m.playerId === currentPlayerId;
          return (
            <div
              key={m.id}
              className={`rounded-lg p-2 ${
                mine ? "bg-blue-900/40" : "bg-gray-900/60"
              }`}
            >
              <div className="mb-0.5 flex items-center justify-between gap-2">
                <span
                  className={`text-xs font-semibold ${
                    m.isBot ? "text-purple-300" : "text-yellow-400"
                  }`}
                >
                  {m.playerName}
                  {m.isBot ? " · BOT" : ""}
                </span>
                <span className="text-[10px] text-gray-500">
                  {formatTime(m.timestamp)}
                </span>
              </div>
              <p className="break-words text-gray-100">{m.message}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          disabled={disabled}
          placeholder={disabled ? "Chat locked for this phase" : "Type a message…"}
          className="flex-1 rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-base text-white placeholder-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 sm:text-sm"
          maxLength={280}
        />
        <button
          onClick={() => void submit()}
          disabled={disabled || draft.trim().length === 0}
          className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-600"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
