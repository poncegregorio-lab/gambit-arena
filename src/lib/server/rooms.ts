import { FightBot } from "@/lib/fight/bot";
import { FightRoom, type Role, type SyncRequest, type SyncResponse } from "@/lib/fight/room";
import { GameError, getGame, resolveFight } from "./games";

interface Entry {
  room: FightRoom;
  gameId: string;
  fightId: string;
  ids: Record<Role, string | null>;
  touched: number;
  /** Bot opponents are simulated in this server process and answer over the network like any player. */
  bot?: { player: FightBot; role: Role };
  persist?: Promise<void>;
}

const g = globalThis as typeof globalThis & { __gambitFightRooms?: Map<string, Entry> };
const rooms: Map<string, Entry> = (g.__gambitFightRooms ??= new Map());

function gone(): SyncResponse {
  return {
    phase: "gone", countdownMs: 0, timeLeftMs: 0, opp: null, events: [],
    hp: { a: 0, d: 0 }, maxHp: { a: 1, d: 1 },
  };
}

function sweep() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, e] of rooms) if (e.touched < cutoff) rooms.delete(k);
}

export async function syncFight(gameId: string, fightId: string, playerId: string, req: SyncRequest): Promise<SyncResponse> {
  let entry = rooms.get(fightId);
  if (!entry) {
    const game = await getGame(gameId);
    const pf = game?.pendingFight;
    if (!game || !pf || pf.id !== fightId) return gone();
    const attackerId = pf.attacker.color === "w" ? game.whiteId : game.blackId;
    const defenderId = pf.defender.color === "w" ? game.whiteId : game.blackId;
    // Check before constructing the room so outsiders cannot start a countdown.
    if (playerId !== attackerId && playerId !== defenderId) throw new GameError("You are not part of this fight", 403);
    const existing = rooms.get(fightId);
    if (existing) entry = existing;
    else {
      entry = {
        room: new FightRoom({
          a: { piece: pf.attacker.piece, color: pf.attacker.color },
          d: { piece: pf.defender.piece, color: pf.defender.color },
        }),
        gameId: game.id, fightId,
        ids: { a: attackerId, d: defenderId }, touched: Date.now(),
      };
      if (game.bot) {
        const role: Role = game.bot.color === pf.attacker.color ? "a" : "d";
        const botPiece = role === "a" ? pf.attacker.piece : pf.defender.piece;
        const humanPiece = role === "a" ? pf.defender.piece : pf.attacker.piece;
        entry.room.bots.add(role);
        entry.bot = { role, player: new FightBot(role, botPiece, humanPiece, game.bot.fightDifficulty) };
      }
      rooms.set(fightId, entry);
      sweep();
    }
  }
  if (entry.gameId !== gameId.toUpperCase()) throw new GameError("Fight does not belong to this game", 404);
  const role: Role | null = playerId === entry.ids.a ? "a" : playerId === entry.ids.d ? "d" : null;
  if (!role) throw new GameError("You are not part of this fight", 403);
  entry.touched = Date.now();

  // The bot moves on the player's own network cadence, so a slow connection slows the bot too.
  if (entry.bot) {
    const { player, role: botRole } = entry.bot;
    const botRes = player.syncAt(Date.now(), req.state ?? null, entry.room.phase === "live", entry.room.hp[botRole] / entry.room.maxHp[botRole]);
    const applied = entry.room.sync(botRole, botRes, Date.now());
    player.receive(applied.events);
  }

  const res = entry.room.sync(role, {
    state: req.state ?? null,
    events: Array.isArray(req.events) ? req.events.slice(0, 40) : [],
    ack: req.ack,
    seq: req.seq,
  });

  if (entry.room.phase === "done" && entry.room.winner) {
    const e = entry;
    const winner: Role = entry.room.winner;
    if (!e.persist) {
      e.persist = resolveFight(e.gameId, e.fightId, winner, e.room.reason ?? "").catch((err) => {
        e.persist = undefined;
        throw err;
      });
    }
    await e.persist;
  }
  return res;
}
