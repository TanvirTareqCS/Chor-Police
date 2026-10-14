import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getDatabase, ref, onValue, off, type Database } from "firebase/database";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db: Database = getDatabase(app);

/**
 * Firebase Realtime Database schema
 * ---------------------------------------------------------------------------
 * rooms/{ROOM_ID}
 *   roomId            string                 six-character join code
 *   hostId            string                 player id of the room host
 *   phase             GamePhase              waiting | deal | chat |
 *                                            results | ended
 *   round             1..roundCount          current round number
 *   createdAt         number (ms)            room creation timestamp
 *   startedAt         number | null          first round start timestamp
 *   endedAt           number | null          game end timestamp
 *   phaseStartTime    number (ms)            SERVER timestamp the phase began
 *   phaseDuration     number (seconds)       length of the current phase
 *   policeId          string | null          publicly revealed during "deal"
 *   accusationSubmitted boolean              police locked the accusation
 *   settings          RoomSettings
 *     maxPlayers      number                 4..8
 *     badChitCount    number                 1..(players-2)
 *     roundCount      number                 default 5
 *     phaseTimers     { deal, chat }         seconds per phase
 *   policeId, society scoring is free-for-all across rounds.
 *
 *   players/{PLAYER_ID}
 *     id, name, isHost, isBot, joinedAt
 *     role      PlayerRole | null            secret chit (self-readable)
 *     status    "active" | "left"
 *
 *   chat/{MESSAGE_ID}
 *     id, playerId, playerName, message, timestamp,
 *     isBot, phase, round
 *
 *   ready/{PLAYER_ID}        boolean         "I've seen my chit" in "deal"
 *
 *   signals/{PLAYER_ID}/{MSG_ID}            transient WebRTC voice signaling
 *     from        string                    (deleted by the recipient as soon
 *     description RTCSessionDescriptionInit  as it is consumed)
 *     candidate   RTCIceCandidateInit
 *
 *   accused/{PLAYER_ID}      boolean         suspects ticked by Police
 *   results/{PLAYER_ID}      number          points earned this round
 *   totalScores/{PLAYER_ID}  number          cumulative score
 *   history/{ROUND}          RoundRecord     frozen round outcome
 * ---------------------------------------------------------------------------
 */

export function subscribeServerTimeOffset(
  cb: (offsetMs: number) => void
): () => void {
  const offsetRef = ref(db, ".info/serverTimeOffset");
  const unsubscribe = onValue(
    offsetRef,
    (snapshot) => cb((snapshot.val() as number | null) ?? 0),
    () => cb(0)
  );
  return () => {
    unsubscribe();
    off(offsetRef);
  };
}

export { app, db };
