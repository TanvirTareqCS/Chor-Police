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
 * Peer-to-peer voice mesh for in-game chat.
 *
 * Media never touches Firebase — only the tiny SDP/ICE handshake does, under
 * `rooms/{roomId}/signals/{recipientId}` (each client consumes and deletes its
 * own inbox). Audio flows directly between browsers over WebRTC.
 *
 * A public STUN server is used by default; add a TURN server via the
 * NEXT_PUBLIC_TURN_* env vars for friends behind strict/symmetric NATs, which
 * is the usual reason two people cannot connect.
 */

const SPEAK_THRESHOLD = 0.045;
const SELF_KEY = "self";

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
  hasRemoteDescription: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  chain: Promise<void>;
}

interface UseVoiceOptions {
  roomId: string | undefined;
  playerId: string | undefined;
  peerIds: string[];
  enabled: boolean;
}

export interface UseVoiceResult {
  /** `self` plus one key per peer, true while that person is talking. */
  speaking: Record<string, boolean>;
  micOn: boolean;
  setMic: (on: boolean) => void;
  error: string | null;
}

export function useVoice({
  roomId,
  playerId,
  peerIds,
  enabled,
}: UseVoiceOptions): UseVoiceResult {
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [micOn, setMicOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const playerIdRef = useRef<string | undefined>(playerId);
  const remoteAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<
    Map<
      string,
      {
        analyser: AnalyserNode;
        data: Uint8Array<ArrayBuffer>;
        source: MediaStreamAudioSourceNode;
        stream: MediaStream;
      }
    >
  >(new Map());
  const rafRef = useRef<number | null>(null);
  const speakingRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  /* ------------------------- speaking detection ------------------------- */

  const getCtx = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!audioCtxRef.current) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      audioCtxRef.current = new Ctor();
    }
    if (audioCtxRef.current.state === "suspended") {
      void audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const tick = useCallback(function loop() {
    const next: Record<string, boolean> = {};
    let changed = false;
    for (const [key, entry] of analysersRef.current) {
      entry.analyser.getByteTimeDomainData(entry.data);
      let sum = 0;
      for (let i = 0; i < entry.data.length; i += 1) {
        const v = (entry.data[i] - 128) / 128;
        sum += v * v;
      }
      const on = Math.sqrt(sum / entry.data.length) > SPEAK_THRESHOLD;
      next[key] = on;
      if (on !== speakingRef.current[key]) changed = true;
    }
    if (Object.keys(speakingRef.current).length !== Object.keys(next).length) {
      changed = true;
    }
    if (changed) {
      speakingRef.current = next;
      setSpeaking(next);
    }
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const syncAnalyser = useCallback(
    (key: string, stream: MediaStream | null) => {
      const existing = analysersRef.current.get(key);
      if (existing && existing.stream === stream) return;
      if (existing) {
        try {
          existing.source.disconnect();
        } catch {
          /* ignore */
        }
        analysersRef.current.delete(key);
      }
      const ctx = getCtx();
      if (!ctx || !stream) {
        if (speakingRef.current[key]) {
          const next = { ...speakingRef.current };
          delete next[key];
          speakingRef.current = next;
          setSpeaking(next);
        }
        return;
      }
      try {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        analysersRef.current.set(key, { analyser, data, source, stream });
        startLoop();
      } catch {
        /* ignore */
      }
    },
    [getCtx, startLoop]
  );

  const removeAnalyser = useCallback((key: string) => {
    const existing = analysersRef.current.get(key);
    if (!existing) return;
    try {
      existing.source.disconnect();
    } catch {
      /* ignore */
    }
    analysersRef.current.delete(key);
    if (speakingRef.current[key]) {
      const next = { ...speakingRef.current };
      delete next[key];
      speakingRef.current = next;
      setSpeaking(next);
    }
  }, []);

  /* ----------------------------- remote audio --------------------------- */

  const setRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
    let el = remoteAudioRef.current.get(peerId);
    if (!el && typeof window !== "undefined") {
      el = new Audio();
      el.autoplay = true;
      remoteAudioRef.current.set(peerId, el);
    }
    if (el && el.srcObject !== stream) {
      el.srcObject = stream;
      void el.play().catch(() => {});
    }
    syncAnalyser(peerId, stream);
  }, [syncAnalyser]);

  /* ----------------------------- signalling ----------------------------- */

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
        hasRemoteDescription: false,
        pendingCandidates: [],
        chain: Promise.resolve(),
      };
      peersRef.current.set(peerId, entry);

      const ls = localStreamRef.current;
      if (ls) for (const track of ls.getTracks()) pc.addTrack(track, ls);

      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) {
            signal(peerId, { description: pc.localDescription.toJSON() });
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
        setRemoteStream(peerId, stream);
        stream.onaddtrack = () => setRemoteStream(peerId, stream);
        stream.onremovetrack = () => setRemoteStream(peerId, stream);
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
    [signal, setRemoteStream]
  );

  const processSignal = useCallback(
    async (peerId: string, entry: PeerEntry, msg: SignalMessage) => {
      const { pc } = entry;
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
        entry.hasRemoteDescription = true;

        const pending = entry.pendingCandidates.splice(0);
        for (const candidate of pending) {
          try {
            await pc.addIceCandidate(candidate);
          } catch {
            /* ignore */
          }
        }

        if (desc.type === "offer") {
          await pc.setLocalDescription();
          if (pc.localDescription) {
            signal(peerId, { description: pc.localDescription.toJSON() });
          }
        }
      } else if (msg.candidate) {
        if (!entry.hasRemoteDescription) {
          entry.pendingCandidates.push(msg.candidate);
          return;
        }
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch {
          /* ignore */
        }
      }
    },
    [signal]
  );

  // Signals are handled strictly in arrival order, so an ICE candidate is never
  // processed before the offer/answer it belongs to.
  const handleSignal = useCallback(
    (msg: SignalMessage) => {
      const peerId = msg.from;
      const entry = peersRef.current.get(peerId) ?? ensurePeer(peerId);
      const run = entry.chain.then(() => processSignal(peerId, entry, msg));
      entry.chain = run.catch(() => {});
      return entry.chain;
    },
    [ensurePeer, processSignal]
  );

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
        const el = remoteAudioRef.current.get(id);
        if (el) el.srcObject = null;
        remoteAudioRef.current.delete(id);
        removeAnalyser(id);
      }
    }
  }, [enabled, roomId, playerId, peerKey, ensurePeer, removeAnalyser]);

  /* ------------------------------- controls ------------------------------ */

  const attachTrack = useCallback(
    (track: MediaStreamTrack, stream: MediaStream) => {
      for (const { pc } of peersRef.current.values()) {
        try {
          pc.addTrack(track, stream);
        } catch {
          /* ignore */
        }
      }
    },
    []
  );

  const setMic = useCallback(
    async (on: boolean) => {
      setError(null);
      const ls = localStreamRef.current ?? new MediaStream();
      localStreamRef.current = ls;
      let track = ls.getAudioTracks()[0];
      if (on) {
        if (!track) {
          if (!navigator.mediaDevices?.getUserMedia) {
            setError("Microphone is not available in this browser.");
            return;
          }
          try {
            const captured = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
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
        syncAnalyser(SELF_KEY, ls);
      } else {
        if (track) {
          track.enabled = false;
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
        }
        setMicOn(false);
        removeAnalyser(SELF_KEY);
      }
    },
    [attachTrack, syncAnalyser, removeAnalyser]
  );

  /* -------------------------------- teardown ----------------------------- */

  useEffect(() => {
    const peers = peersRef.current;
    const audioEls = remoteAudioRef.current;
    const analysers = analysersRef.current;
    const ctxRef = audioCtxRef;
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      for (const { pc } of peers.values()) {
        try {
          pc.close();
        } catch {
          /* ignore */
        }
      }
      peers.clear();
      for (const el of audioEls.values()) el.srcObject = null;
      audioEls.clear();
      for (const { source } of analysers.values()) {
        try {
          source.disconnect();
        } catch {
          /* ignore */
        }
      }
      analysers.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      void ctxRef.current?.close();
    };
  }, []);

  return {
    speaking,
    micOn,
    setMic: (on: boolean) => void setMic(on),
    error,
  };
}
