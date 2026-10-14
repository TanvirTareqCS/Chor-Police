# 🚔 Chor Police: The Syndicate

A 4–8 player, room-based social deduction game for the browser. Deal secret
chits, bluff your way through a live interrogation, and watch the Police hunt
the Bad Chits across several rounds. Everyone plays for themselves.

Built with **Next.js 16** (App Router), **React 19**, **Tailwind CSS v4**, and
**Firebase Realtime Database**, with optional **AI-driven bot players** powered
by an LLM provider (Groq / OpenAI / Google).

---

## 🎮 How to Play

1. **Create a room** or **join** one with a 6-character code.
2. The host adds bots (optional) and starts the game with 4–8 players.
3. Each player secretly receives one chit. The **Police** is always revealed
   publicly; everyone else's chit stays hidden until the payout.
4. Play out the round, then repeat for the configured number of rounds
   (5–20). Highest total score wins.

### Rounds & Phases

| Phase | What happens |
| --- | --- |
| **Lobby** | Players join, host configures the room and starts. |
| **Phase 1 · The Deal** | Chits are dealt face-down. Everyone confirms "I've seen my chit" to advance (or the timer runs out). |
| **Phase 2 · Interrogation** | Live chat opens. Innocents defend, Bad Chits bluff, and the Police may **lock an accusation at any moment** — the round ends immediately when they do. |
| **Payout & Leaderboard** | Scores are revealed for the round; standings update. Auto-advances after 8 seconds. |
| **Game Over** | Final leaderboard. The host can start a rematch. |

### Roles & Scoring

Babu and Police are **always** dealt. Every seat receives a real chit — there
are no blank seats.

**Good roles** keep their guaranteed points each round, no matter the outcome:

| Role | Points |
| --- | --- |
| 👑 **Babu** (King) | 1000 |
| 🎩 **Mantri** (Minister) | 800 |
| 🛡️ **Kotwal** (Guard) | 600 |
| ⚖️ **Bicharpoti** (Judge) | 400 |

**Police** 🚔 scores **500 only if they accuse every Bad Chit and no innocent**.
Otherwise they get nothing and the 500 is split equally among the undetected
Bad Chits.

**Bad roles** 🥷 survive by avoiding the Police and splitting the 500:

- 🥷 **Chor** (Thief) · 🔫 **Dakaat** (Robber) · 🤏 **Pocketmar** (Pickpocket) · 🧰 **Shinduk-Chor** (Safe Cracker)

> The Police can tick at most as many suspects as there are Bad Chits, so every
> accusation is all-or-nothing.

---

## 🤖 AI Bots

Bots are driven by the host's browser and can chat and accuse like real players,
powered by an LLM through a server route (`/api/bot/chat`). The provider is
configurable — **Groq**, **OpenAI**, or **Google Gemini** — and gracefully falls
back to canned lines if no API key is present, so the game always works offline
of any AI provider.

---

## 🛠 Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack, Cache Components)
- **UI:** React 19 + Tailwind CSS v4 + lucide-react icons
- **Realtime:** Firebase Realtime Database (no auth; room codes gate access)
- **AI:** Vercel AI SDK with Groq / OpenAI / Google adapters
- **Language:** TypeScript

### Architecture notes

- The **host client is the phase engine** — it advances phases on a
  server-synced timer (`serverTimestamp()` + `.info/serverTimeOffset`). There is
  no backend ticker. If the host closes their tab mid-game, the room pauses
  until the host returns.
- All players subscribe to the same `rooms/{roomId}` node, so state, chat, and
  accusations sync in real time.
- The app tolerates legacy room data via a `normalizeRoom()` layer.
- **On-seat video/voice** rides a peer-to-peer WebRTC mesh (`useRtc`), signaled
  through the transient `rooms/{roomId}/signals/{playerId}` node. Each player
  turns their own mic/camera on and off; streams render on that player's seat.
  A free public STUN server is used by default — set the `NEXT_PUBLIC_TURN_*`
  variables for friends behind strict NATs. Camera/mic require a secure context
  (HTTPS or `localhost`).

---

## 🚀 Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env.local` in the project root:

```dotenv
# Firebase Realtime Database (public — safe for the browser)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_DATABASE_URL=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# AI provider (server-side only — never exposed to the client)
AI_PROVIDER=groq          # groq | openai | gemini
AI_MODEL=llama-3.3-70b-versatile
AI_API_KEY=

# Optional TURN server for WebRTC behind strict NATs (public STUN is built in)
NEXT_PUBLIC_TURN_URL=
NEXT_PUBLIC_TURN_USERNAME=
NEXT_PUBLIC_TURN_CREDENTIAL=
```

> **Firebase:** create a project, enable **Realtime Database**, and copy the web
> app config into the `NEXT_PUBLIC_FIREBASE_*` variables.

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) on your phone or desktop.
The UI is fully responsive down to small phone screens.

### 4. Build for production

```bash
npm run build
npm run start
```

---

## 🔒 Firebase Rules

The game has no authentication, so your Realtime Database rules must allow the
game's reads and writes. For a casual/private game:

```json
{
  "rules": {
    "rooms": {
      ".read": true,
      ".write": true
    }
  }
}
```

Tighten these (field/size validation) before making the game public.

---

## ☁️ Deployment

### Vercel (recommended)

1. Push this repository to GitHub.
2. On [vercel.com](https://vercel.com), **Add New → Project** and import the repo.
3. Framework auto-detects **Next.js** — keep the default build settings.
4. Add the environment variables above under **Settings → Environment Variables**
   (the `NEXT_PUBLIC_FIREBASE_*` values are inlined at build time; `AI_*` are
   used at runtime).
5. Deploy. Every push to `main` redeploys automatically.

### Any Node host / Docker

```bash
npm ci
npm run build
npm start   # serves on http://localhost:3000
```

`NEXT_PUBLIC_*` must be present at **build** time; `AI_*` must be present at
**runtime**.

---

## 📜 Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm run start` | Run the production build |
| `npm run lint` | Lint with ESLint |

---

## 📄 License

Released for personal and educational use.
