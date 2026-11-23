import { GameError, cleanId, errorResponse, playBotTurn } from "@/lib/server/games";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (!Number.isInteger(body.version) || body.version < 0) throw new GameError("A game version is required", 400);
    const view = await playBotTurn(id, cleanId(body.playerId), body.version);
    return Response.json({ view });
  } catch (e) {
    return errorResponse(e);
  }
}
