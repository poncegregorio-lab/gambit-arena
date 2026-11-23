import { GameError, cleanId, cleanName, createGame, errorResponse, listOpenGames } from "@/lib/server/games";
import { readBotSettings } from "@/lib/bots/difficulty";
import { isMapChoice } from "@/lib/fight/maps";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ games: await listOpenGames() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const playerId = cleanId(body.playerId);
    const settings = body.mode === "bot" ? readBotSettings(body.bot) : null;
    if (body.mode === "bot" && !settings) throw new GameError("Choose valid, separate chess and fight difficulty levels", 400);
    const map = body.map === undefined ? "random" : body.map;
    if (!isMapChoice(map)) throw new GameError("Unknown arena", 400);
    const out = await createGame(playerId, cleanName(body.name), String(body.color ?? "random"), settings, map);
    return Response.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
