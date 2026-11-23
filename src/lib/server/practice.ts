import { randomUUID } from "node:crypto";
import { FightBot } from "@/lib/fight/bot";
import { getMapDef, isMapChoice } from "@/lib/fight/maps";
import { FightRoom, type Role, type SyncRequest, type SyncResponse } from "@/lib/fight/room";
import type { PieceType } from "@/lib/chess";
import { PIECES } from "@/lib/fight/weapons";
import type { Difficulty } from "@/lib/bots/difficulty";
import { isDifficulty } from "@/lib/bots/difficulty";

/**
 * Practice duels are served over the network too: the training bot runs in this server process and
 * every state update and hit travels over HTTP, exactly like playing a friend across the WiFi.
 * Sessions live in memory and expire when abandoned.
 */
interface Session {
  room: FightRoom;
  bot: FightBot;
  human: Role;
  touched: number;
}

const globalSessions = globalThis as typeof globalThis & { __gambitPractice?: Map<string, Session> };
const sessions: Map<string, Session> = (globalSessions.__gambitPractice ??= new Map());

const SESSION_TTL_MS = 15 * 60 * 1000;
const PIECE_TYPES = Object.keys(PIECES) as PieceType[];

export class PracticeError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function sweep() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [k, v] of sessions) if (v.touched < cutoff) sessions.delete(k);
}

export interface PracticeRequest {
  myPiece: unknown;
  oppPiece: unknown;
  mapId: unknown;
  fightDifficulty: unknown;
}

export function createPractice(req: PracticeRequest): { id: string; mapId: string; oppPiece: PieceType; oppName: string } {
  const pick = (v: unknown, label: string): PieceType => {
    if (typeof v !== "string" || !PIECE_TYPES.includes(v as PieceType)) throw new PracticeError(`Unknown piece for ${label}`);
    return v as PieceType;
  };
  const myPiece = pick(req.myPiece, "you");
  const oppPiece = pick(req.oppPiece, "the bot");
  if (!isMapChoice(req.mapId)) throw new PracticeError("Unknown arena");
  if (!isDifficulty(req.fightDifficulty)) throw new PracticeError("Unknown capture fight difficulty");
  const mapId = getMapDef(req.mapId as string).id;

  const id = `prac-${randomUUID()}`;
  const room = new FightRoom({ a: { piece: myPiece, color: "w" }, d: { piece: oppPiece, color: "b" } });
  room.bots.add("d");
  sessions.set(id, { room, bot: new FightBot("d", oppPiece, myPiece, req.fightDifficulty as Difficulty), human: "a", touched: Date.now() });
  sweep();
  return { id, mapId, oppPiece, oppName: `${PIECES[oppPiece].name} bot` };
}

function gone(): SyncResponse {
  return {
    phase: "gone",
    countdownMs: 0,
    timeLeftMs: 0,
    opp: null,
    events: [],
    hp: { a: 0, d: 0 },
    maxHp: { a: 1, d: 1 },
  };
}

export async function syncPractice(id: string, req: SyncRequest): Promise<SyncResponse> {
  const session = sessions.get(id);
  if (!session) return gone();
  session.touched = Date.now();
  const now = Date.now();
  const { room, bot } = session;

  // The training bot advances on every sync from the player, so it moves in real time over the network.
  const botReq = bot.syncAt(now, req.state ?? null, room.phase === "live", room.hp.d / room.maxHp.d);
  const botRes = room.sync("d", botReq, now);
  bot.receive(botRes.events);
  return room.sync(session.human, { state: req.state ?? null, events: Array.isArray(req.events) ? req.events.slice(0, 40) : [], ack: req.ack, seq: req.seq }, now);
}
