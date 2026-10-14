"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/lib/firebase";
import {
  off,
  onChildAdded,
  push,
  ref as dbRef,
  remove,
  type Unsubscribe,
} from "firebase/database";

/**
 * Peer-to-peer WebRTC mesh for on-seat video/audio.
 *
 * Signaling rides on Firebase Realtime Database under
 * `rooms/{roomId}/signals/{recipientId}` (each client only listens to its own
 * inbox and deletes messages as it consumes them).
 *
 * Media is only requested when the player explicitly turns their mic/camera on,
 * and each toggle is per-person. A free public STUN server is used; add a TURN
 * server via NEXT_PUBLIC_TURN_* for friends behind strict NATs.
 */

/** A fresh MediaStream sharing the same underlying tracks, so React sees a new
 * reference whenever tracks are added or removed (needed for re-renders). */
function materialize(src: MediaStream): MediaStream {
  const next = new MediaStream();
  for (const track of src.getTracks()) next.addTrack(track);
  return next;
}

function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const url = process.env.NEXT_PUBLIC_TURN_URL;
  if (url) {
    servers.push({
      urls: url,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}

interface SignalMessage {
  from: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

interface UseRtcOptions {
  roomId: string | undefined;
  playerId: string | undefined;
  peerIds: string[];
  enabled: boolean;
}

export interface UseRtcResult {
  remoteStreams: Record<string, MediaStream>;
  localStream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  setMic: (on: boolean) => void;
  setCam: (on: boolean) => void;
  error: string | null;
}

export function useRtc({
  roomId,
  playerId,
  peerIds,
  enabled,
}: UseRtcOptions): UseRtcResult {
  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const playerIdRef = useRef<string | undefined>(playerId);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  const signal = useCallback(
    (to: string, payload: Omit<SignalMessage, "from">) => {
      const me = playerIdRef.current;
      if (!roomId || !me) return;
      void push(dbRef(db, `rooms/${roomId}/signals/${to}`), {
        from: me,
        ...payload,
      });
    },
    [roomId]
  );

  const pump = useCallback((peerId: string, stream: MediaStream) => {
    setRemoteStreams((prev) => ({ ...prev, [peerId]: materialize(stream) }));
  }, []);

  const ensurePeer = useCallback(
    (peerId: string): PeerEntry => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const me = playerIdRef.current ?? "";
      const pc = new RTCPeerConnection({ iceServers: getIceServers() });
      const entry: PeerEntry = {
        pc,
        polite: me > peerId,
        makingOffer: false,
        ignoreOffer: false,
      };
      peersRef.current.set(peerId, entry);

      const ls = localStreamRef.current;
      if (ls) for (const track of ls.getTracks()) pc.addTrack(track, ls);

      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) {
            signal(peerId, {
              description: pc.localDescription.toJSON(),
            });
          }
        } catch {
          /* ignore */
        } finally {
          entry.makingOffer = false;
        }
      };

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) signal(peerId, { candidate: candidate.toJSON() });
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        pump(peerId, stream);
        stream.onaddtrack = () => pump(peerId, stream);
        stream.onremovetrack = () => pump(peerId, stream);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          try {
            pc.restartIce();
          } catch {
            /* ignore */
          }
        }
      };

      return entry;
    },
    [pump, signal]
  );

  const handleSignal = useCallback(
    async (msg: SignalMessage) => {
      const peerId = msg.from;
      const entry = peersRef.current.get(peerId) ?? ensurePeer(peerId);
      const { pc } = entry;
      try {
        if (msg.description) {
          const desc = msg.description;
          const offerCollision =
            desc.type === "offer" &&
            (entry.makingOffer || pc.signalingState !== "stable");
          entry.ignoreOffer = !entry.polite && offerCollision;
          if (entry.ignoreOffer) return;

          if (offerCollision) {
            await Promise.all([
              pc.setLocalDescription({ type: "rollback" }),
              pc.setRemoteDescription(desc),
            ]);
          } else {
            await pc.setRemoteDescription(desc);
          }

          if (desc.type === "offer") {
            await pc.setLocalDescription();
            if (pc.localDescription) {
              signal(peerId, {
                description: pc.localDescription.toJSON(),
              });
            }
          }
        } else if (msg.candidate) {
          try {
            await pc.addIceCandidate(msg.candidate);
          } catch {
            /* candidate can arrive before the remote description */
          }
        }
      } catch {
        /* ignore malformed signal */
      }
    },
    [ensurePeer, signal]
  );

  // Subscribe to our own signaling inbox.
  useEffect(() => {
    if (!enabled || !roomId || !playerId) return;
    const inboxRef = dbRef(db, `rooms/${roomId}/signals/${playerId}`);
    const unsub: Unsubscribe = onChildAdded(inboxRef, (snap) => {
      const msg = snap.val() as SignalMessage | null;
      void remove(snap.ref);
      if (msg && msg.from) void handleSignal(msg);
    });
    return () => {
      unsub();
      off(inboxRef);
      void remove(inboxRef);
    };
  }, [enabled, roomId, playerId, handleSignal]);

  // Keep one peer connection per other human player.
  const peerKey = useMemo(() => [...peerIds].sort().join(","), [peerIds]);
  useEffect(() => {
    if (!enabled || !roomId || !playerId) return;
    const wanted = new Set(peerKey ? peerKey.split(",") : []);
    for (const id of wanted) ensurePeer(id);
    for (const id of Array.from(peersRef.current.keys())) {
      if (!wanted.has(id)) {
        try {
          peersRef.current.get(id)?.pc.close();
        } catch {
          /* ignore */
        }
        peersRef.current.delete(id);
      }
    }
  }, [enabled, roomId, playerId, peerKey, ensurePeer]);

  // Tear everything down on unmount.
  useEffect(() => {
    const peers = peersRef.current;
    const local = localStreamRef;
    return () => {
      for (const { pc } of peers.values()) {
        try {
          pc.close();
        } catch {
          /* ignore */
        }
      }
      peers.clear();
      local.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const attachTrack = useCallback((track: MediaStreamTrack, stream: MediaStream) => {
    for (const { pc } of peersRef.current.values()) {
      try {
        pc.addTrack(track, stream);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const setMic = useCallback(
    async (on: boolean) => {
      setError(null);
      const ls = localStreamRef.current ?? new MediaStream();
      localStreamRef.current = ls;
      let track = ls.getAudioTracks()[0];
      if (on) {
        if (!track) {
          try {
            const captured = await navigator.mediaDevices.getUserMedia({
              audio: true,
            });
            track = captured.getAudioTracks()[0];
            ls.addTrack(track);
            attachTrack(track, ls);
          } catch {
            setError("Microphone permission was blocked.");
            return;
          }
        }
        track.enabled = true;
        setMicOn(true);
      } else {
        if (track) track.enabled = false;
        setMicOn(false);
      }
    },
    [attachTrack]
  );

  const setCam = useCallback(
    async (on: boolean) => {
      setError(null);
      const ls = localStreamRef.current ?? new MediaStream();
      localStreamRef.current = ls;
      if (on) {
        let track = ls.getVideoTracks()[0];
        if (!track) {
          try {
            const captured = await navigator.mediaDevices.getUserMedia({
              video: true,
            });
            track = captured.getVideoTracks()[0];
            ls.addTrack(track);
            attachTrack(track, ls);
          } catch {
            setError("Camera permission was blocked.");
            return;
          }
        }
        track.enabled = true;
        setCamOn(true);
        setLocalStream(materialize(ls));
      } else {
        const track = ls.getVideoTracks()[0];
        if (track) {
          for (const { pc } of peersRef.current.values()) {
            const sender = pc.getSenders().find((s) => s.track === track);
            if (sender) {
              try {
                pc.removeTrack(sender);
              } catch {
                /* ignore */
              }
            }
          }
          ls.removeTrack(track);
          track.stop();
        }
        setCamOn(false);
        setLocalStream(materialize(ls));
      }
    },
    [attachTrack]
  );

  return {
    remoteStreams,
    localStream,
    micOn,
    camOn,
    setMic: (on: boolean) => void setMic(on),
    setCam: (on: boolean) => void setCam(on),
    error,
  };
}
