"use client";

import { useEffect, useRef } from "react";

/**
 * Renders a single player's camera stream inside their seat. Falls back to the
 * seat's avatar (rendered by the parent) when there is no live video track.
 */
export function SeatVideo({
  stream,
  muted,
  className,
}: {
  stream: MediaStream | null;
  muted: boolean;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    if (stream) {
      const play = () => void video.play().catch(() => {});
      play();
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className={className}
    />
  );
}
