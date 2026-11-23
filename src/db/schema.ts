import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { FightSummary, MoveRecord, PendingFight } from "@/lib/chess";
import type { BotConfig } from "@/lib/bots/difficulty";

export const games = pgTable("games", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("waiting"), // waiting | active | finished
  whiteId: text("white_id"),
  blackId: text("black_id"),
  whiteName: text("white_name"),
  blackName: text("black_name"),
  fen: text("fen").notNull(),
  moves: jsonb("moves").$type<MoveRecord[]>().notNull().default([]),
  positions: jsonb("positions").$type<string[]>().notNull().default([]),
  pendingFight: jsonb("pending_fight").$type<PendingFight | null>(),
  lastFight: jsonb("last_fight").$type<FightSummary | null>(),
  result: text("result"), // white | black | draw
  resultReason: text("result_reason"),
  drawOfferBy: text("draw_offer_by"), // w | b
  bot: jsonb("bot").$type<BotConfig | null>(), // null for human-vs-human games
  map: text("map").notNull().default("random"), // arena id or "random"
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GameRow = typeof games.$inferSelect;
