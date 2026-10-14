"use client";

import { useMemo } from "react";

const CONFETTI_COLORS = [
  "#f59e0b",
  "#ef4444",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#eab308",
];

interface Piece {
  left: number;
  delay: number;
  duration: number;
  color: string;
  width: number;
}

// Built once at module load so render stays pure (no Math.random in render).
const POOL: Piece[] = Array.from({ length: 160 }, () => ({
  left: Math.random() * 100,
  delay: Math.random() * 0.7,
  duration: 2.2 + Math.random() * 1.8,
  color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
  width: 6 + Math.round(Math.random() * 7),
}));

export function Confetti({ count = 80, seed = 0 }: { count?: number; seed?: number }) {
  const pieces = useMemo(() => {
    const start = Math.abs(Math.floor(seed)) % POOL.length;
    return Array.from(
      { length: Math.min(count, POOL.length) },
      (_, i) => POOL[(start + i * 7) % POOL.length]
    );
  }, [count, seed]);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="cp-confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.width,
            height: p.width * 1.5,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

export function FlashOverlay({
  tone,
  trigger,
}: {
  tone: "good" | "bad" | "alarm";
  trigger: string | number;
}) {
  const background =
    tone === "good"
      ? "radial-gradient(circle, rgba(34,197,94,0.5), transparent 70%)"
      : tone === "bad"
        ? "radial-gradient(circle, rgba(239,68,68,0.55), transparent 70%)"
        : "radial-gradient(circle, rgba(59,130,246,0.5), transparent 70%)";

  return (
    <div
      key={`${tone}-${trigger}`}
      className="cp-flash-overlay"
      style={{ background }}
    />
  );
}
