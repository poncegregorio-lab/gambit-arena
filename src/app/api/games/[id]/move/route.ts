import type { PieceType, Square } from "@/lib/chess";
import { GameError, cleanId, errorResponse, submitMove } from "@/lib/server/games";

export const dynamic = "force-dynamic";

const SQUARE = /^[a-h][1-8]$/;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const from = String(body.from ?? "");
    const to = String(body.to ?? "");
    if (!SQUARE.test(from) || !SQUARE.test(to)) throw new GameError("Invalid squares", 400);
    const promotion = ["q", "r", "b", "n"].includes(body.promotion) ? (body.promotion as PieceType) : undefined;
    const view = await submitMove(id, cleanId(body.playerId), from as Square, to as Square, promotion);
    return Response.json({ view });
  } catch (e) {
    return errorResponse(e);
  }
}
