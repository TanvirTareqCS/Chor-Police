import { Suspense } from "react";
import { RoomLobby } from "@/components/RoomLobby";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-4 text-white">
      <div className="mx-auto max-w-7xl">
        <header className="mb-10 pt-8 text-center">
          <h1 className="mb-2 text-4xl font-bold text-red-500 md:text-6xl">
            CHOR POLICE
          </h1>
          <h2 className="text-xl text-yellow-400 md:text-2xl">
            The Syndicate
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-gray-400">
            A 4-8 player, room-based social deduction game. Deal the chits,
            argue your case in the interrogation, and let the Police hunt the
            Bad Chits across 5-20 rounds. Everyone for themselves.
          </p>
        </header>
        <Suspense fallback={null}>
          <RoomLobby />
        </Suspense>
        <section className="mx-auto mt-10 max-w-4xl rounded-xl border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-400">
          <h3 className="mb-3 text-base font-semibold text-gray-200">
            How to play
          </h3>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Create a room or join with a 6-character code.</li>
            <li>
              The host adds bots and starts the game with 4-8 players.
            </li>
            <li>
              Phase 1 · Deal (everyone confirms their chit) → Phase 2 ·
              Interrogation, where the Police may lock an accusation at any
              moment.
            </li>
            <li>
              Babu 1000, Mantri 800, Kotwal 600, Bicharpoti 400. Police must
              catch every Bad Chit for 500, else it is split.
            </li>
          </ol>
        </section>
      </div>
    </main>
  );
}
