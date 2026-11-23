import type { Color, FightSummary, MoveRecord, PendingFight } from "@/lib/chess";
import type { BotConfig } from "@/lib/bots/difficulty";

export interface GameView {
  id: string;
  status: "waiting" | "active" | "finished";
  fen: string;
  turn: Color;
  moves: MoveRecord[];
  white: { name: string | null; joined: boolean };
  black: { name: string | null; joined: boolean };
  myColor: Color | null;
  canJoin: boolean;
  pendingFight: PendingFight | null;
  lastFight: FightSummary | null;
  result: "white" | "black" | "draw" | null;
  resultReason: string | null;
  drawOfferBy: Color | null;
  bot: BotConfig | null;
  map: string;
  version: number;
}

export interface OpenGame {
  id: string;
  hostName: string;
  hostColor: "white" | "black";
  createdAt: string;
}
