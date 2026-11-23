"use client";

import { useMemo, useState } from "react";
import { PIECE_NAMES, type PieceType } from "@/lib/chess";
import { api } from "@/lib/client";
import { DIFFICULTY_LABELS, type Difficulty } from "@/lib/bots/difficulty";
import { getMapDef } from "@/lib/fight/maps";
import type { Transport } from "@/lib/fight/engine";
import type { SyncResponse } from "@/lib/fight/room";
import { PIECE_ORDER } from "@/lib/fight/weapons";
import { DifficultyPicker } from "./DifficultyPicker";
import { FightScreen } from "./FightScreen";
import { MapPicker } from "./MapPicker";
import { PieceGuideCard } from "./PieceGuide";
import { PieceIcon } from "./PieceIcon";

function Picker({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: PieceType;
  onChange: (p: PieceType) => void;
  color: "w" | "b";
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6f788d]">{label}</div>
      <div className="grid grid-cols-6 gap-1.5">
        {PIECE_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            title={PIECE_NAMES[p]}
            className={`flex flex-col items-center gap-0.5 rounded-xl border py-2 text-[10px] font-semibold transition ${
              value === p
                ? "border-amber-300/70 bg-amber-300/10 text-white"
                : "border-white/10 bg-white/[0.03] text-[#8d96ab] hover:bg-white/[0.08]"
            }`}
          >
            <PieceIcon type={p} color={color} size={34} />
            {PIECE_NAMES[p]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Practice duels run on the server: the training bot is simulated in the server process and every
 * update travels over the network, exactly like a real opponent across the WiFi.
 */
export function PracticeClient() {
  const [mine, setMine] = useState<PieceType>("n");
  const [theirs, setTheirs] = useState<PieceType>("p");
  const [mapPref, setMapPref] = useState("random");
  const [fightDifficulty, setFightDifficulty] = useState<Difficulty>("medium");
  const [run, setRun] = useState<number | null>(null);
  const [session, setSession] = useState<{ id: string; mapId: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transport = useMemo<Transport | null>(() => {
    const id = session?.id;
    if (!id) return null;
    return async (req) => {
      try {
        const r = await fetch("/api/practice/fight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fightId: id, req }),
          cache: "no-store",
        });
        if (!r.ok) return null;
        return (await r.json()) as SyncResponse;
      } catch {
        return null;
      }
    };
  }, [session?.id]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const s = await api<{ id: string; mapId: string }>("/api/practice", {
        myPiece: mine,
        oppPiece: theirs,
        mapId: mapPref,
        fightDifficulty,
      });
      setSession(s);
      setRun((r) => (r ?? 0) + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the practice duel");
    } finally {
      setStarting(false);
    }
  }

  const mapId = session?.mapId ?? "grand-board";

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-10">
      <div className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-white">Practice arena</h1>
        <p className="mt-2 text-[#9aa3b8]">
          Learn a piece&apos;s weapons against a bot before you risk it in a real game. Pick your piece and the enemy, then jump in. The
          training bot runs on the server, so these duels are played over the network just like a real opponent.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[460px_1fr]">
        <div className="card space-y-6 p-5 lg:sticky lg:top-20">
          <Picker label="You play" value={mine} onChange={setMine} color="w" />
          <Picker label="Bot plays" value={theirs} onChange={setTheirs} color="b" />
          <MapPicker value={mapPref} onChange={setMapPref} />
          <DifficultyPicker kind="fight" value={fightDifficulty} onChange={setFightDifficulty} />
          <button className="btn btn-primary w-full !py-3" disabled={starting || !!session} onClick={() => void start()}>
            {starting ? "Starting…" : session ? "Duel ready" : `⚔ Start duel — ${PIECE_NAMES[mine]} vs ${PIECE_NAMES[theirs]}`}
          </button>
          {error && <p className="text-sm text-rose-300" role="alert">{error}</p>}
          <p className="text-xs leading-relaxed text-[#6f788d]">
            Desktop with a mouse and keyboard recommended — phones and tablets use the on-screen stick and buttons. The bot plays the same
            rules, timer and weapons as a real player.
          </p>
        </div>
        <PieceGuideCard piece={mine} color="w" />
      </div>

      {run !== null && session && transport && (
        <FightScreen
          key={session.id}
          mode="practice"
          role="a"
          myPiece={mine}
          oppPiece={theirs}
          myColor="w"
          oppColor="b"
          myName="You"
          oppName={`${DIFFICULTY_LABELS[fightDifficulty]} ${PIECE_NAMES[theirs]} bot`}
          mapId={mapId}
          transport={transport}
          opponentDifficulty={fightDifficulty}
          headline={`Practice · ${getMapDef(mapId).name}`}
          describe={(winner, reason) => {
            const won = winner === "a";
            return {
              title: won ? "You won the duel!" : "The bot got you",
              detail:
                (won ? "Nice work — try the same fight again or another matchup." : "Check the guide for tips, then run it back.") +
                (reason ? ` (${reason})` : ""),
              good: won,
            };
          }}
          onExit={() => {
            setSession(null);
            setRun(null);
          }}
        />
      )}
    </main>
  );
}
