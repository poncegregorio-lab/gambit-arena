"use client";

import { DIFFICULTIES, DIFFICULTY_DESCRIPTIONS, DIFFICULTY_LABELS, type Difficulty } from "@/lib/bots/difficulty";

export function DifficultyPicker({
  kind,
  value,
  onChange,
  disabled = false,
}: {
  kind: "board" | "fight";
  value: Difficulty;
  onChange: (value: Difficulty) => void;
  disabled?: boolean;
}) {
  const title = kind === "board" ? "Chess difficulty" : "Capture fight difficulty";
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2 disabled:opacity-50">
      <legend className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#aeb6c8]">
        <span aria-hidden className={kind === "board" ? "text-[#5ab4ff]" : "text-amber-300"}>{kind === "board" ? "♟" : "⚔"}</span>
        {title}
      </legend>
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={title}>
        {DIFFICULTIES.map((d, index) => (
          <button
            key={d}
            type="button"
            aria-pressed={value === d}
            onClick={() => onChange(d)}
            className={`flex min-w-0 flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 text-[11px] font-semibold transition disabled:cursor-not-allowed ${
              value === d
                ? kind === "board"
                  ? "border-[#5ab4ff]/60 bg-[#5ab4ff]/10 text-[#9ad1ff]"
                  : "border-amber-300/60 bg-amber-300/10 text-amber-200"
                : "border-white/[0.08] bg-white/[0.03] text-[#8d96ab] hover:border-white/20 hover:text-white"
            }`}
          >
            <span aria-hidden className="flex h-2.5 items-end gap-0.5">
              {[0, 1, 2, 3].map((n) => (
                <span key={n} className={`w-1 rounded-sm ${n <= index ? "bg-current" : "bg-white/10"}`} style={{ height: 4 + n * 2 }} />
              ))}
            </span>
            {DIFFICULTY_LABELS[d]}
          </button>
        ))}
      </div>
      <p className="min-h-8 text-xs leading-snug text-[#8d96ab]">{DIFFICULTY_DESCRIPTIONS[kind][value]}</p>
    </fieldset>
  );
}
