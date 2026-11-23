import type { Color } from "@/lib/chess";

export const DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface BotSettings {
  boardDifficulty: Difficulty;
  fightDifficulty: Difficulty;
}

export interface BotConfig extends BotSettings {
  color: Color;
}

export const DEFAULT_BOT_SETTINGS: BotSettings = {
  boardDifficulty: "medium",
  fightDifficulty: "medium",
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  expert: "Expert",
};

export const DIFFICULTY_DESCRIPTIONS: Record<"board" | "fight", Record<Difficulty, string>> = {
  board: {
    easy: "Learning the ropes. Short-sighted moves and frequent mistakes.",
    medium: "Plans ahead, develops pieces, and spots simple tactics.",
    hard: "Deeper tactical search. Protect your pieces and watch for threats.",
    expert: "Our deepest search, with careful positioning and very few deliberate mistakes.",
  },
  fight: {
    easy: "Slower reactions, forgiving aim, and less frequent ability use.",
    medium: "Steady aim, active movement, and regular use of weapons and abilities.",
    hard: "Quick reactions, sharper aim, and more aggressive movement.",
    expert: "Fast tracking, precise shots, and relentless use of abilities. Stay in cover.",
  },
};

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && (DIFFICULTIES as readonly string[]).includes(value);
}

export function readBotSettings(value: unknown): BotSettings | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isDifficulty(v.boardDifficulty) || !isDifficulty(v.fightDifficulty)) return null;
  return { boardDifficulty: v.boardDifficulty, fightDifficulty: v.fightDifficulty };
}

// These only change behaviour, never the underlying piece stats, damage, health, or cooldown rules.
export const FIGHT_LEVELS: Record<Difficulty, {
  reaction: number;
  turnSpeed: number;
  accuracy: number;
  headshots: number;
  movement: number;
  strafe: number;
  cadence: number;
  abilityDelay: number;
  secondaryRate: number;
  jumpRate: number;
}> = {
  easy: {
    reaction: 1.1, turnSpeed: 1.9, accuracy: 0.42, headshots: 0.025,
    movement: 0.65, strafe: 0.25, cadence: 1.9, abilityDelay: 1.9, secondaryRate: 0.15, jumpRate: 0.06,
  },
  medium: {
    reaction: 0.65, turnSpeed: 3.6, accuracy: 0.72, headshots: 0.08,
    movement: 0.85, strafe: 0.6, cadence: 1.3, abilityDelay: 1.3, secondaryRate: 0.4, jumpRate: 0.16,
  },
  hard: {
    reaction: 0.32, turnSpeed: 5.2, accuracy: 0.95, headshots: 0.16,
    movement: 0.95, strafe: 0.8, cadence: 1.08, abilityDelay: 1.08, secondaryRate: 0.7, jumpRate: 0.28,
  },
  expert: {
    reaction: 0.16, turnSpeed: 7.2, accuracy: 1.15, headshots: 0.26,
    movement: 1, strafe: 0.95, cadence: 1, abilityDelay: 1, secondaryRate: 1.1, jumpRate: 0.42,
  },
};
