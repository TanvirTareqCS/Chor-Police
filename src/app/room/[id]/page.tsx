import { Suspense } from "react";
import { GameBoard } from "@/components/GameBoard";

export default function RoomPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
          Loading the syndicate…
        </div>
      }
    >
      <GameBoard />
    </Suspense>
  );
}
