"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DIFFICULTY_LABELS, type BotConfig, type BotSettings } from "@/lib/bots/difficulty";
import { api } from "@/lib/client";
import type { Color } from "@/lib/chess";
import { DifficultyPicker } from "./DifficultyPicker";

export function BotGamePanel({
  config, canEdit, busy, finished, playerId, playerName, humanColor, onSave,
}: {
  config: BotConfig;
  canEdit: boolean;
  busy: boolean;
  finished: boolean;
  playerId: string;
  playerName: string;
  humanColor: Color | null;
  onSave: (settings: BotSettings) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<BotSettings>(config);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft({ boardDifficulty: config.boardDifficulty, fightDifficulty: config.fightDifficulty });
  }, [config.boardDifficulty, config.fightDifficulty]);
  const dirty = draft.boardDifficulty !== config.boardDifficulty || draft.fightDifficulty !== config.fightDifficulty;

  async function again() {
    setStarting(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/api/games", {
        playerId, name: playerName, color: humanColor === "b" ? "black" : "white",
        mode: "bot", bot: { boardDifficulty: config.boardDifficulty, fightDifficulty: config.fightDifficulty },
      });
      router.push(`/game/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the game");
      setStarting(false);
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-3 p-4 pb-3">
        <div aria-hidden className="grid h-10 w-10 place-items-center rounded-xl border border-[#5ab4ff]/20 bg-[#5ab4ff]/10 text-lg">🤖</div>
        <div>
          <h2 className="text-sm font-semibold text-white">Playing Arena Bot</h2>
          <p className="mt-0.5 text-[11px] text-[#8d96ab]">Two skills. Two independent difficulty levels.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 pb-4">
        <div className="rounded-lg border border-[#5ab4ff]/15 bg-[#5ab4ff]/5 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8d96ab]">Chess</div>
          <div className="mt-0.5 text-sm font-semibold text-[#9ad1ff]">{DIFFICULTY_LABELS[config.boardDifficulty]}</div>
        </div>
        <div className="rounded-lg border border-amber-300/15 bg-amber-300/5 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8d96ab]">Capture fights</div>
          <div className="mt-0.5 text-sm font-semibold text-amber-200">{DIFFICULTY_LABELS[config.fightDifficulty]}</div>
        </div>
      </div>
      {humanColor && !finished && (
        <details className="border-t border-white/[0.06]">
          <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-[#aeb6c8] hover:text-white">Adjust bot difficulty</summary>
          <div className="space-y-4 px-4 pb-4">
            <DifficultyPicker kind="board" value={draft.boardDifficulty} disabled={!canEdit || busy} onChange={(boardDifficulty) => setDraft((v) => ({ ...v, boardDifficulty }))} />
            <DifficultyPicker kind="fight" value={draft.fightDifficulty} disabled={!canEdit || busy} onChange={(fightDifficulty) => setDraft((v) => ({ ...v, fightDifficulty }))} />
            <p className="text-[11px] leading-relaxed text-[#6f788d]">
              {canEdit
                ? "Changes apply to future moves and duels only. Raising one level never changes the other."
                : "You can change either level on your turn, after the current move or duel ends."}
            </p>
            <button className="btn btn-ghost w-full !py-2 !text-xs" disabled={!dirty || !canEdit || busy} onClick={() => onSave(draft)}>
              {busy ? "Saving…" : dirty ? "Apply difficulty settings" : "Settings saved"}
            </button>
          </div>
        </details>
      )}
      {humanColor && finished && (
        <div className="border-t border-white/[0.06] p-4">
          <button className="btn btn-primary w-full" disabled={starting} onClick={() => void again()}>{starting ? "Starting…" : "Play again with these settings"}</button>
          {error && <p className="mt-2 text-xs text-rose-300" role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}
